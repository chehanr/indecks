import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

import { FileSystem } from "@effect/platform";
import type { Db } from "@indecks/db";
import { chunk as chunkTable } from "@indecks/db/schema/chunk";
import { indexer as indexerTable } from "@indecks/db/schema/indexer";
import { job as jobTable } from "@indecks/db/schema/job";
import { library as libraryTable } from "@indecks/db/schema/library";
import { video as videoTable } from "@indecks/db/schema/video";
import type { VectorDb, VectorDbManagerShape } from "@indecks/vector";
import { and, eq, inArray } from "drizzle-orm";
import { Context, Duration, Effect, Layer } from "effect";
import { nanoid } from "nanoid";

import type { EmbedConfig } from "./embedder";
import { EmbedService } from "./embedder";
import {
	JobCancelledError,
	LibraryEmbeddingNotConfiguredError,
	LibraryNotFoundError,
	VideoNotFoundError,
} from "./errors";
import { FFmpegService } from "./ffmpeg";

type ProgressFn = (progress: number, message: string) => Effect.Effect<void>;

export interface IndexerContext {
	readonly chunkDuration: number;
	readonly chunkOverlap: number;
	readonly config: EmbedConfig;
	readonly downscaleFps: number;
	readonly indexerId: string;
	readonly instruction?: string;
	readonly jobId?: string;
	readonly vectorDb: VectorDb;
}

const makeChunkId = (
	videoId: string,
	indexerId: string,
	startTime: number
): string => {
	const raw = `${videoId}:${indexerId}:${startTime}`;
	return createHash("sha256").update(raw).digest("hex").slice(0, 16);
};

const hashFile = (filePath: string): Effect.Effect<string> =>
	Effect.async<string>((resume) => {
		const hash = createHash("sha256");
		const stream = createReadStream(filePath);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resume(Effect.succeed(hash.digest("hex"))));
		stream.on("error", () => resume(Effect.succeed("")));
	});

export interface ProcessorServiceShape {
	readonly indexLibrary: (
		db: Db,
		vectorDbManager: VectorDbManagerShape,
		libraryId: string,
		indexerId: string,
		jobId?: string,
		onProgress?: ProgressFn
	) => Effect.Effect<
		void,
		| LibraryNotFoundError
		| LibraryEmbeddingNotConfiguredError
		| JobCancelledError
	>;
	readonly processVideo: (
		db: Db,
		videoId: string,
		indexerId: string,
		vectorDbManager: VectorDbManagerShape,
		jobId?: string,
		onProgress?: ProgressFn
	) => Effect.Effect<void, VideoNotFoundError | JobCancelledError>;
	readonly scanLibraryFolder: (
		db: Db,
		libraryId: string,
		onProgress?: ProgressFn
	) => Effect.Effect<number, LibraryNotFoundError>;
}

export class ProcessorService extends Context.Tag("ProcessorService")<
	ProcessorService,
	ProcessorServiceShape
>() {}

const progress = (fn: ProgressFn | undefined, pct: number, msg: string) =>
	fn ? fn(pct, msg) : Effect.void;

export const ProcessorServiceLive = Layer.effect(
	ProcessorService,
	Effect.gen(function* () {
		const ffmpeg = yield* FFmpegService;
		const embedSvc = yield* EmbedService;
		const fs = yield* FileSystem.FileSystem;

		interface ExistingVideo {
			fileHash: string | null;
			filePath: string;
			id: string;
		}

		const detectChangedVideos = (
			db: Db,
			videos: ExistingVideo[]
		): Effect.Effect<number> =>
			Effect.gen(function* () {
				let changed = 0;
				for (const vid of videos) {
					const currentHash = yield* hashFile(vid.filePath);
					if (vid.fileHash && vid.fileHash !== currentHash) {
						yield* Effect.promise(() =>
							db.delete(chunkTable).where(eq(chunkTable.videoId, vid.id))
						);
						const duration = yield* ffmpeg
							.getVideoDuration(vid.filePath)
							.pipe(Effect.option);
						const fileStat = yield* fs.stat(vid.filePath).pipe(Effect.orDie);
						yield* Effect.promise(() =>
							db
								.update(videoTable)
								.set({
									fileHash: currentHash,
									fileSize: Number(fileStat.size),
									duration: duration._tag === "Some" ? duration.value : null,
									status: "pending",
									errorMessage: null,
								})
								.where(eq(videoTable.id, vid.id))
						);
						changed++;
					} else if (!vid.fileHash) {
						yield* Effect.promise(() =>
							db
								.update(videoTable)
								.set({ fileHash: currentHash })
								.where(eq(videoTable.id, vid.id))
						);
					}
				}
				return changed;
			});

		const addNewVideos = (
			db: Db,
			libraryId: string,
			newPaths: string[],
			onProgress?: ProgressFn
		): Effect.Effect<number> =>
			Effect.gen(function* () {
				let added = 0;
				for (const filePath of newPaths) {
					const fileName = filePath.split("/").pop() ?? filePath;
					const fileStat = yield* fs.stat(filePath).pipe(Effect.orDie);
					const fileHash = yield* hashFile(filePath);
					const duration = yield* ffmpeg
						.getVideoDuration(filePath)
						.pipe(Effect.option);

					yield* Effect.promise(() =>
						db.insert(videoTable).values({
							id: nanoid(),
							libraryId,
							filePath,
							fileName,
							fileSize: Number(fileStat.size),
							fileHash,
							duration: duration._tag === "Some" ? duration.value : null,
							status: "pending",
						})
					);

					added++;
					const pct = Math.round(
						10 + (newPaths.indexOf(filePath) / newPaths.length) * 90
					);
					yield* progress(onProgress, pct, `Found ${added} new videos...`);
				}
				return added;
			});

		const scanLibraryFolder = (
			db: Db,
			libraryId: string,
			onProgress?: ProgressFn
		): Effect.Effect<number, LibraryNotFoundError> =>
			Effect.gen(function* () {
				const lib = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(libraryTable)
							.where(eq(libraryTable.id, libraryId))
							.get(),
					catch: () => new LibraryNotFoundError({ libraryId }),
				});

				if (!lib) {
					return yield* new LibraryNotFoundError({ libraryId });
				}

				yield* progress(onProgress, 0, "Scanning folders for videos...");

				const folderPaths: string[] = JSON.parse(lib.folderPaths);
				const allVideoPaths: string[] = [];
				for (const folderPath of folderPaths) {
					const paths = yield* ffmpeg.scanDirectory(folderPath);
					allVideoPaths.push(...paths);
				}
				const videoPaths = [...new Set(allVideoPaths)];
				const diskPaths = new Set(videoPaths);

				const existingVideos = yield* Effect.promise(() =>
					db
						.select({
							id: videoTable.id,
							filePath: videoTable.filePath,
							fileHash: videoTable.fileHash,
						})
						.from(videoTable)
						.where(eq(videoTable.libraryId, libraryId))
						.all()
				);

				// Remove videos whose files no longer exist on disk
				const staleIds = existingVideos
					.filter((v) => !diskPaths.has(v.filePath))
					.map((v) => v.id);

				if (staleIds.length > 0) {
					yield* Effect.promise(() =>
						db.delete(videoTable).where(inArray(videoTable.id, staleIds))
					);
					yield* progress(
						onProgress,
						5,
						`Removed ${staleIds.length} missing videos.`
					);
				}

				// Check for changed files (hash mismatch)
				const currentVideos = existingVideos.filter((v) =>
					diskPaths.has(v.filePath)
				);
				const changed = yield* detectChangedVideos(db, currentVideos);

				if (changed > 0) {
					yield* progress(
						onProgress,
						10,
						`${changed} videos changed, will re-index.`
					);
				}

				// Add new videos
				const existingPaths = new Set(existingVideos.map((v) => v.filePath));
				const newPaths = videoPaths.filter((p) => !existingPaths.has(p));
				const added = yield* addNewVideos(db, libraryId, newPaths, onProgress);

				yield* Effect.promise(() =>
					db
						.update(libraryTable)
						.set({
							videoCount: videoPaths.length,
							status: "idle",
						})
						.where(eq(libraryTable.id, libraryId))
				);

				yield* progress(
					onProgress,
					100,
					`Scan complete. ${added} added, ${changed} changed, ${staleIds.length} removed.`
				);
				return added + changed;
			});

		const checkCancelled = (db: Db, jobId?: string) =>
			Effect.gen(function* () {
				if (!jobId) {
					return;
				}
				const row = yield* Effect.promise(() =>
					db
						.select({ status: jobTable.status })
						.from(jobTable)
						.where(eq(jobTable.id, jobId))
						.get()
				);
				if (row?.status === "cancelled") {
					return yield* new JobCancelledError({ jobId });
				}
			});

		const processVideoForIndexer = (
			db: Db,
			vid: { id: string; filePath: string; fileName: string },
			ctx: IndexerContext,
			onProgress?: ProgressFn
		): Effect.Effect<void, JobCancelledError> =>
			Effect.gen(function* () {
				const chunkOpts = {
					chunkDuration: ctx.chunkDuration,
					overlap: ctx.chunkOverlap,
				};

				const chunks = yield* ffmpeg
					.chunkVideo(vid.filePath, chunkOpts)
					.pipe(Effect.catchAll(() => Effect.succeed([])));

				const totalChunks = chunks.length;
				let processed = 0;

				yield* Effect.forEach(
					chunks,
					(chunkInfo) =>
						Effect.gen(function* () {
							yield* checkCancelled(db, ctx.jobId);
							const chunkId = makeChunkId(
								vid.id,
								ctx.indexerId,
								chunkInfo.startTime
							);
							const still = yield* ffmpeg.isStillFrame(chunkInfo.chunkPath);

							yield* Effect.promise(() =>
								db
									.insert(chunkTable)
									.values({
										id: chunkId,
										videoId: vid.id,
										indexerId: ctx.indexerId,
										startTime: chunkInfo.startTime,
										endTime: chunkInfo.endTime,
										isStillFrame: still,
										embeddingStatus: still ? "skipped" : "pending",
									})
									.onConflictDoNothing()
							);

							if (still) {
								processed++;
								const pct = Math.round((processed / totalChunks) * 100);
								yield* progress(
									onProgress,
									pct,
									`Chunk ${processed}/${totalChunks} (skipped - still frame)`
								);
								return;
							}

							const downscaledPath = yield* ffmpeg
								.downscaleChunk(chunkInfo.chunkPath, {
									fps: ctx.downscaleFps,
								})
								.pipe(Effect.catchAll(() => Effect.succeed(null)));

							if (downscaledPath) {
								const videoBytes = yield* fs
									.readFile(downscaledPath)
									.pipe(Effect.orDie);
								const videoBuffer = Buffer.from(videoBytes);

								const embeddingResult = yield* embedSvc
									.embedVideo(videoBuffer, ctx.config, ctx.instruction)
									.pipe(Effect.either);

								if (embeddingResult._tag === "Right") {
									yield* ctx.vectorDb
										.upsert(chunkId, new Float32Array(embeddingResult.right))
										.pipe(
											Effect.flatMap(() =>
												Effect.promise(() =>
													db
														.update(chunkTable)
														.set({ embeddingStatus: "embedded" })
														.where(eq(chunkTable.id, chunkId))
												)
											),
											Effect.catchAll(() =>
												Effect.promise(() =>
													db
														.update(chunkTable)
														.set({ embeddingStatus: "error" })
														.where(eq(chunkTable.id, chunkId))
												)
											)
										);
								} else {
									yield* Effect.promise(() =>
										db
											.update(chunkTable)
											.set({ embeddingStatus: "error" })
											.where(eq(chunkTable.id, chunkId))
									);
								}

								yield* fs.remove(downscaledPath).pipe(Effect.ignore);
							} else {
								yield* Effect.promise(() =>
									db
										.update(chunkTable)
										.set({ embeddingStatus: "error" })
										.where(eq(chunkTable.id, chunkId))
								);
							}

							processed++;
							const pct = Math.round((processed / totalChunks) * 100);
							yield* progress(
								onProgress,
								pct,
								`Embedded chunk ${processed}/${totalChunks}`
							);
						}).pipe(
							Effect.timeout(Duration.minutes(5)),
							Effect.catchTag("TimeoutException", () =>
								Effect.gen(function* () {
									const chunkId = makeChunkId(
										vid.id,
										ctx.indexerId,
										chunkInfo.startTime
									);
									yield* Effect.promise(() =>
										db
											.update(chunkTable)
											.set({ embeddingStatus: "error" })
											.where(eq(chunkTable.id, chunkId))
									);
									processed++;
									const pct = Math.round((processed / totalChunks) * 100);
									yield* progress(
										onProgress,
										pct,
										`Chunk ${processed}/${totalChunks} (timed out)`
									);
								})
							)
						),
					{ concurrency: 4 }
				);

				yield* ffmpeg.cleanupChunks(chunks);
			});

		const processVideo = (
			db: Db,
			videoId: string,
			indexerId: string,
			vectorDbManager: VectorDbManagerShape,
			jobId?: string,
			onProgress?: ProgressFn
		): Effect.Effect<void, VideoNotFoundError | JobCancelledError> =>
			Effect.gen(function* () {
				const vid = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(videoTable)
							.where(eq(videoTable.id, videoId))
							.get(),
					catch: () => new VideoNotFoundError({ videoId }),
				});

				if (!vid) {
					return yield* new VideoNotFoundError({ videoId });
				}

				const emb = yield* Effect.promise(() =>
					db
						.select()
						.from(indexerTable)
						.where(eq(indexerTable.id, indexerId))
						.get()
				);

				if (!emb) {
					return;
				}

				const vectorDb = yield* vectorDbManager
					.get(vid.libraryId, emb.id, emb.dimensions)
					.pipe(Effect.orDie);

				const embConfig: EmbedConfig = {
					apiKey: emb.apiKey ?? "",
					baseUrl: emb.baseUrl,
					dimensions: emb.dimensions,
					model: emb.model,
				};

				yield* progress(onProgress, 0, "Testing embedding API connection...");
				const preflight = yield* embedSvc.testConnection(embConfig);
				if (!preflight.ok) {
					yield* Effect.die(
						new Error(
							`Embedding API preflight failed: ${preflight.error ?? "unknown error"}`
						)
					);
				}

				const indexer: IndexerContext = {
					indexerId: emb.id,
					vectorDb,
					jobId,
					config: embConfig,
					instruction: emb.instruction ?? undefined,
					chunkDuration: emb.chunkDuration,
					chunkOverlap: emb.chunkOverlap,
					downscaleFps: emb.downscaleFps,
				};

				yield* Effect.promise(() =>
					db
						.update(videoTable)
						.set({ status: "processing" })
						.where(eq(videoTable.id, videoId))
				);

				yield* progress(onProgress, 0, `Processing ${vid.fileName}...`);
				yield* processVideoForIndexer(db, vid, indexer, onProgress);

				const errorChunks = yield* Effect.promise(() =>
					db
						.select({ id: chunkTable.id })
						.from(chunkTable)
						.where(
							and(
								eq(chunkTable.videoId, videoId),
								eq(chunkTable.indexerId, indexerId),
								eq(chunkTable.embeddingStatus, "error")
							)
						)
						.all()
				);

				yield* Effect.promise(() =>
					db
						.update(videoTable)
						.set({
							status: errorChunks.length > 0 ? "error" : "indexed",
							errorMessage:
								errorChunks.length > 0
									? `${errorChunks.length} chunk(s) failed to embed`
									: null,
						})
						.where(eq(videoTable.id, videoId))
				);
			}).pipe(
				Effect.catchAllDefect((err) =>
					Effect.promise(() => {
						const errorMessage =
							err instanceof Error ? err.message : String(err);
						return db
							.update(videoTable)
							.set({ status: "error", errorMessage })
							.where(eq(videoTable.id, videoId));
					}).pipe(Effect.asVoid)
				)
			);

		const indexLibrary = (
			db: Db,
			vectorDbManager: VectorDbManagerShape,
			libraryId: string,
			indexerId: string,
			jobId?: string,
			onProgress?: ProgressFn
		): Effect.Effect<
			void,
			| LibraryNotFoundError
			| LibraryEmbeddingNotConfiguredError
			| JobCancelledError
		> =>
			Effect.gen(function* () {
				const lib = yield* Effect.tryPromise({
					try: () =>
						db
							.select()
							.from(libraryTable)
							.where(eq(libraryTable.id, libraryId))
							.get(),
					catch: () => new LibraryNotFoundError({ libraryId }),
				});

				if (!lib) {
					return yield* new LibraryNotFoundError({ libraryId });
				}

				const emb = yield* Effect.promise(() =>
					db
						.select()
						.from(indexerTable)
						.where(eq(indexerTable.id, indexerId))
						.get()
				);

				if (!emb) {
					return yield* new LibraryEmbeddingNotConfiguredError({
						libraryId,
					});
				}

				const embConfig: EmbedConfig = {
					apiKey: emb.apiKey ?? "",
					baseUrl: emb.baseUrl,
					dimensions: emb.dimensions,
					model: emb.model,
				};

				yield* progress(onProgress, 0, "Testing embedding API connection...");
				const preflight = yield* embedSvc.testConnection(embConfig);
				if (!preflight.ok) {
					yield* Effect.die(
						new Error(
							`Embedding API preflight failed: ${preflight.error ?? "unknown error"}`
						)
					);
				}

				const vectorDb = yield* vectorDbManager
					.get(libraryId, emb.id, emb.dimensions)
					.pipe(Effect.orDie);

				const indexer: IndexerContext = {
					indexerId: emb.id,
					vectorDb,
					jobId,
					config: embConfig,
					instruction: emb.instruction ?? undefined,
					chunkDuration: emb.chunkDuration,
					chunkOverlap: emb.chunkOverlap,
					downscaleFps: emb.downscaleFps,
				};

				yield* Effect.promise(() =>
					db
						.update(libraryTable)
						.set({ status: "scanning" })
						.where(eq(libraryTable.id, libraryId))
				);

				yield* scanLibraryFolder(db, libraryId, onProgress);

				yield* Effect.promise(() =>
					db
						.update(libraryTable)
						.set({ status: "indexing" })
						.where(eq(libraryTable.id, libraryId))
				);

				const videos = yield* Effect.promise(() =>
					db
						.select()
						.from(videoTable)
						.where(eq(videoTable.libraryId, libraryId))
						.all()
				);

				const videosToProcess = videos.filter((v) => v.status === "pending");
				let processed = 0;

				for (const vid of videosToProcess) {
					yield* checkCancelled(db, jobId);

					yield* Effect.promise(() =>
						db
							.delete(chunkTable)
							.where(
								and(
									eq(chunkTable.videoId, vid.id),
									eq(chunkTable.indexerId, indexer.indexerId)
								)
							)
					);

					yield* Effect.promise(() =>
						db
							.update(videoTable)
							.set({ status: "processing" })
							.where(eq(videoTable.id, vid.id))
					);

					const vidProgress: ProgressFn | undefined = onProgress
						? (pct, msg) => {
								const overallPct = Math.round(
									((processed + pct / 100) / videosToProcess.length) * 100
								);
								return progress(
									onProgress,
									overallPct,
									`Video ${processed + 1}/${videosToProcess.length}: ${msg}`
								);
							}
						: undefined;

					yield* processVideoForIndexer(db, vid, indexer, vidProgress);

					const errorChunks = yield* Effect.promise(() =>
						db
							.select({ id: chunkTable.id })
							.from(chunkTable)
							.where(
								and(
									eq(chunkTable.videoId, vid.id),
									eq(chunkTable.indexerId, indexer.indexerId),
									eq(chunkTable.embeddingStatus, "error")
								)
							)
							.all()
					);

					yield* Effect.promise(() =>
						db
							.update(videoTable)
							.set({
								status: errorChunks.length > 0 ? "error" : "indexed",
								errorMessage:
									errorChunks.length > 0
										? `${errorChunks.length} chunk(s) failed to embed`
										: null,
							})
							.where(eq(videoTable.id, vid.id))
					);
					processed++;
				}

				yield* Effect.promise(() =>
					db
						.update(libraryTable)
						.set({ status: "ready" })
						.where(eq(libraryTable.id, libraryId))
				);

				yield* progress(onProgress, 100, "Indexing complete.");
			});

		return { scanLibraryFolder, processVideo, indexLibrary };
	})
);
