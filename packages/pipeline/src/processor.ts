import { createHash } from "node:crypto";

import { FileSystem } from "@effect/platform";
import type { Db } from "@indecks/db";
import { chunk as chunkTable } from "@indecks/db/schema/chunk";
import { indexer as indexerTable } from "@indecks/db/schema/indexer";
import { library as libraryTable } from "@indecks/db/schema/library";
import { video as videoTable } from "@indecks/db/schema/video";
import type { VectorDb, VectorDbManagerShape } from "@indecks/vector";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { nanoid } from "nanoid";

import type { EmbedConfig } from "./embedder";
import { EmbedService } from "./embedder";
import {
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

export interface ProcessorServiceShape {
	readonly indexLibrary: (
		db: Db,
		vectorDbManager: VectorDbManagerShape,
		libraryId: string,
		indexerId: string,
		onProgress?: ProgressFn
	) => Effect.Effect<
		void,
		LibraryNotFoundError | LibraryEmbeddingNotConfiguredError
	>;
	readonly processVideo: (
		db: Db,
		videoId: string,
		indexerId: string,
		vectorDbManager: VectorDbManagerShape,
		onProgress?: ProgressFn
	) => Effect.Effect<void, VideoNotFoundError>;
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

				yield* progress(onProgress, 0, "Scanning folder for videos...");

				const videoPaths = yield* ffmpeg.scanDirectory(lib.folderPath);

				const existingVideos = yield* Effect.tryPromise({
					try: () =>
						db
							.select({ filePath: videoTable.filePath })
							.from(videoTable)
							.where(eq(videoTable.libraryId, libraryId))
							.all(),
					catch: () => new LibraryNotFoundError({ libraryId }),
				});
				const existingPaths = new Set(existingVideos.map((v) => v.filePath));

				let added = 0;
				for (const filePath of videoPaths) {
					if (existingPaths.has(filePath)) {
						continue;
					}

					const fileName = filePath.split("/").pop() ?? filePath;
					const fileStat = yield* fs.stat(filePath).pipe(Effect.orDie);
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
							duration: duration._tag === "Some" ? duration.value : null,
							status: "pending",
						})
					);

					added++;
					const pct = Math.round(
						(videoPaths.indexOf(filePath) / videoPaths.length) * 100
					);
					yield* progress(onProgress, pct, `Found ${added} new videos...`);
				}

				yield* Effect.promise(() =>
					db
						.update(libraryTable)
						.set({ videoCount: videoPaths.length, status: "idle" })
						.where(eq(libraryTable.id, libraryId))
				);

				yield* progress(
					onProgress,
					100,
					`Scan complete. ${added} new videos found.`
				);
				return added;
			});

		const processVideoForIndexer = (
			db: Db,
			vid: { id: string; filePath: string; fileName: string },
			ctx: IndexerContext,
			onProgress?: ProgressFn
		): Effect.Effect<void> =>
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
						}),
					{ concurrency: 1 }
				);

				yield* ffmpeg.cleanupChunks(chunks);
			});

		const processVideo = (
			db: Db,
			videoId: string,
			indexerId: string,
			vectorDbManager: VectorDbManagerShape,
			onProgress?: ProgressFn
		): Effect.Effect<void, VideoNotFoundError> =>
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

				const indexer: IndexerContext = {
					indexerId: emb.id,
					vectorDb,
					config: {
						apiKey: emb.apiKey ?? "",
						baseUrl: emb.baseUrl,
						dimensions: emb.dimensions,
						model: emb.model,
					},
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

				yield* Effect.promise(() =>
					db
						.update(videoTable)
						.set({ status: "indexed" })
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
			onProgress?: ProgressFn
		): Effect.Effect<
			void,
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

				const vectorDb = yield* vectorDbManager
					.get(libraryId, emb.id, emb.dimensions)
					.pipe(Effect.orDie);

				const indexer: IndexerContext = {
					indexerId: emb.id,
					vectorDb,
					config: {
						apiKey: emb.apiKey ?? "",
						baseUrl: emb.baseUrl,
						dimensions: emb.dimensions,
						model: emb.model,
					},
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

				const existingChunks = yield* Effect.promise(() =>
					db
						.select({ videoId: chunkTable.videoId })
						.from(chunkTable)
						.where(eq(chunkTable.indexerId, indexer.indexerId))
						.all()
				);
				const indexedVideoIds = new Set(existingChunks.map((c) => c.videoId));
				const videosToProcess = videos.filter(
					(v) => !indexedVideoIds.has(v.id)
				);
				let processed = 0;

				for (const vid of videosToProcess) {
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

					yield* Effect.promise(() =>
						db
							.update(videoTable)
							.set({ status: "indexed" })
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
