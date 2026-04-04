import { basename } from "node:path";

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
	const hash = Bun.SHA256.hash(raw, "hex") as string;
	return hash.slice(0, 16);
};

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

		const processDiscoveredFile = (
			db: Db,
			libraryId: string,
			filePath: string,
			existing: ExistingVideo | undefined
		): Effect.Effect<"added" | "changed" | "unchanged"> =>
			Effect.gen(function* () {
				const fileName = basename(filePath);

				if (existing) {
					const bunFile = Bun.file(filePath);
					const exists = yield* Effect.promise(() => bunFile.exists());
					if (!exists) {
						return "unchanged";
					}

					const currentSize = bunFile.size;
					const currentMtime = bunFile.lastModified;
					const dbMtime = existing.modifiedAt?.getTime() ?? null;

					if (
						dbMtime !== null &&
						currentMtime === dbMtime &&
						existing.fileSize === currentSize
					) {
						return "unchanged";
					}

					yield* Effect.promise(() =>
						db.delete(chunkTable).where(eq(chunkTable.videoId, existing.id))
					);
					const duration = yield* ffmpeg
						.getVideoDuration(filePath)
						.pipe(Effect.option);
					yield* Effect.promise(() =>
						db
							.update(videoTable)
							.set({
								fileSize: currentSize,
								modifiedAt: new Date(currentMtime),
								duration: duration._tag === "Some" ? duration.value : null,
								status: "pending",
								errorMessage: null,
							})
							.where(eq(videoTable.id, existing.id))
					);
					return "changed";
				}

				const bunFile = Bun.file(filePath);
				const duration = yield* ffmpeg
					.getVideoDuration(filePath)
					.pipe(Effect.option);
				yield* Effect.promise(() =>
					db.insert(videoTable).values({
						id: nanoid(),
						libraryId,
						filePath,
						fileName,
						fileSize: bunFile.size,
						modifiedAt: new Date(bunFile.lastModified),
						duration: duration._tag === "Some" ? duration.value : null,
						status: "pending",
					})
				);
				return "added";
			});

		interface ExistingVideo {
			filePath: string;
			fileSize: number | null;
			id: string;
			modifiedAt: Date | null;
		}

		const discoverVideoPaths = (
			folderPaths: string[],
			onProgress?: ProgressFn
		): Effect.Effect<string[]> =>
			Effect.gen(function* () {
				const allVideoPaths: string[] = [];
				for (const [fi, folderPath] of folderPaths.entries()) {
					const folderPct = Math.round((fi / folderPaths.length) * 10);
					yield* progress(onProgress, folderPct, `Scanning: ${folderPath}`);
					yield* Effect.logInfo(`Scanning folder: ${folderPath}`);
					const paths = yield* ffmpeg.scanDirectory(folderPath);
					yield* Effect.logInfo(
						`Found ${paths.length} videos in ${folderPath}`
					);
					allVideoPaths.push(...paths);
				}
				return [...new Set(allVideoPaths)];
			});

		const processAndCountFiles = (
			db: Db,
			libraryId: string,
			videoPaths: string[],
			dbByPath: Map<string, ExistingVideo>,
			onProgress?: ProgressFn
		): Effect.Effect<{ added: number; changed: number }> =>
			Effect.gen(function* () {
				const results: string[] = [];
				const total = videoPaths.length;

				yield* Effect.forEach(
					videoPaths,
					(filePath, i) =>
						Effect.gen(function* () {
							const existing = dbByPath.get(filePath);
							if (existing) {
								dbByPath.delete(filePath);
							}

							const result = yield* processDiscoveredFile(
								db,
								libraryId,
								filePath,
								existing
							);
							results.push(result);

							if (i % 10 === 0 || i === total - 1) {
								const pct = 10 + Math.round(((i + 1) / total) * 85);
								yield* progress(
									onProgress,
									pct,
									`Processing: ${basename(filePath)} (${i + 1}/${total})`
								);
							}
						}),
					{ concurrency: 5 }
				);

				return {
					added: results.filter((r) => r === "added").length,
					changed: results.filter((r) => r === "changed").length,
				};
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

				yield* Effect.promise(() =>
					db
						.update(libraryTable)
						.set({ status: "scanning" })
						.where(eq(libraryTable.id, libraryId))
				);

				const folderPaths: string[] = JSON.parse(lib.folderPaths);
				const videoPaths = yield* discoverVideoPaths(folderPaths, onProgress);

				const existingVideos = yield* Effect.promise(() =>
					db
						.select({
							id: videoTable.id,
							filePath: videoTable.filePath,
							fileSize: videoTable.fileSize,
							modifiedAt: videoTable.modifiedAt,
						})
						.from(videoTable)
						.where(eq(videoTable.libraryId, libraryId))
						.all()
				);
				const dbByPath = new Map(existingVideos.map((v) => [v.filePath, v]));

				yield* progress(
					onProgress,
					10,
					`Found ${videoPaths.length} videos. Processing...`
				);

				const { added, changed } = yield* processAndCountFiles(
					db,
					libraryId,
					videoPaths,
					dbByPath,
					onProgress
				);

				// Remove stale videos (in DB but not on disk)
				const staleIds = [...dbByPath.values()].map((v) => v.id);
				if (staleIds.length > 0) {
					yield* Effect.promise(() =>
						db.delete(videoTable).where(inArray(videoTable.id, staleIds))
					);
				}

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
									`${vid.fileName} — Chunk ${processed}/${totalChunks} (skipped)`
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
								`${vid.fileName} — Chunk ${processed}/${totalChunks}`
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
										`${vid.fileName} — Chunk ${processed}/${totalChunks} (timed out)`
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

				yield* progress(onProgress, 0, "Testing embedding API...");
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

				yield* progress(onProgress, 0, `Indexing: ${vid.fileName}`);
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

		const indexSingleVideo = (
			db: Db,
			vid: typeof videoTable.$inferSelect,
			indexer: IndexerContext,
			onProgress?: ProgressFn
		): Effect.Effect<void, JobCancelledError> =>
			Effect.gen(function* () {
				yield* checkCancelled(db, indexer.jobId);

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

				yield* processVideoForIndexer(db, vid, indexer, onProgress);

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
			});

		const resolveIndexer = (
			db: Db,
			vectorDbManager: VectorDbManagerShape,
			libraryId: string,
			indexerId: string,
			jobId?: string,
			onProgress?: ProgressFn
		): Effect.Effect<
			IndexerContext,
			LibraryNotFoundError | LibraryEmbeddingNotConfiguredError
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

				yield* Effect.logInfo("Testing embedding API connection...");
				yield* progress(onProgress, 0, "Testing embedding API...");
				const preflight = yield* embedSvc.testConnection(embConfig);
				if (!preflight.ok) {
					yield* Effect.die(
						new Error(
							`Embedding API preflight failed: ${preflight.error ?? "unknown error"}`
						)
					);
				}
				yield* Effect.logInfo("Embedding API connection OK");

				yield* Effect.logInfo("Opening vector DB...");
				const vectorDb = yield* vectorDbManager
					.get(libraryId, emb.id, emb.dimensions)
					.pipe(Effect.orDie);
				yield* Effect.logInfo("Vector DB ready");

				return {
					indexerId: emb.id,
					vectorDb,
					jobId,
					config: embConfig,
					instruction: emb.instruction ?? undefined,
					chunkDuration: emb.chunkDuration,
					chunkOverlap: emb.chunkOverlap,
					downscaleFps: emb.downscaleFps,
				};
			});

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
				const indexer = yield* resolveIndexer(
					db,
					vectorDbManager,
					libraryId,
					indexerId,
					jobId,
					onProgress
				);

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

				if (videosToProcess.length === 0) {
					yield* progress(onProgress, 100, "No pending videos to index.");
					yield* Effect.promise(() =>
						db
							.update(libraryTable)
							.set({ status: "ready" })
							.where(eq(libraryTable.id, libraryId))
					);
					return;
				}

				let processed = 0;
				const total = videosToProcess.length;

				for (const vid of videosToProcess) {
					const vidProgress: ProgressFn | undefined = onProgress
						? (pct, msg) => {
								const overallPct = Math.round(
									((processed + pct / 100) / total) * 100
								);
								return progress(
									onProgress,
									overallPct,
									`(${processed + 1}/${total}) ${msg}`
								);
							}
						: undefined;

					yield* indexSingleVideo(db, vid, indexer, vidProgress);
					processed++;
				}

				yield* Effect.promise(() =>
					db
						.update(libraryTable)
						.set({ status: "ready" })
						.where(eq(libraryTable.id, libraryId))
				);
			});

		return { scanLibraryFolder, processVideo, indexLibrary };
	})
);
