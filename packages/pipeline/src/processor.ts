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
import { Context, Duration, Effect, Layer, Queue } from "effect";
import { nanoid } from "nanoid";

import type { EmbedConfig } from "./embedder";
import { EmbedService } from "./embedder";
import {
	JobCancelledError,
	LibraryEmbeddingNotConfiguredError,
	LibraryNotFoundError,
	VideoNotFoundError,
} from "./errors";
import type { ChunkInfo } from "./ffmpeg";
import { FFmpegService } from "./ffmpeg";

type ProgressFn = (progress: number, message: string) => Effect.Effect<void>;

export interface IndexerContext {
	readonly chunkDuration: number;
	readonly chunkOverlap: number;
	readonly concurrency: number;
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

		interface ExistingVideo {
			filePath: string;
			fileSize: number | null;
			id: string;
			modifiedAt: Date | null;
		}

		// Phase 1: Walk filesystem, collect video paths. No DB, no ffprobe.
		const walkFolders = (
			folderPaths: string[],
			onProgress?: ProgressFn
		): Effect.Effect<string[]> =>
			Effect.gen(function* () {
				const all: string[] = [];
				for (const folder of folderPaths) {
					yield* progress(onProgress, -1, `Scanning: ${folder}`);
					const paths = yield* ffmpeg.scanDirectory(folder);
					all.push(...paths);
				}
				return [...new Set(all)];
			});

		// Handle a single file: mtime+size check only, no ffprobe.
		const handleFile = (
			db: Db,
			libraryId: string,
			filePath: string,
			existing: ExistingVideo | undefined
		): Effect.Effect<"added" | "changed" | "unchanged"> =>
			Effect.gen(function* () {
				const bunFile = Bun.file(filePath);

				if (existing) {
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
					yield* Effect.promise(() =>
						db
							.update(videoTable)
							.set({
								fileSize: currentSize,
								modifiedAt: new Date(currentMtime),
								duration: null,
								status: "pending",
								errorMessage: null,
							})
							.where(eq(videoTable.id, existing.id))
					);
					return "changed";
				}

				yield* Effect.promise(() =>
					db.insert(videoTable).values({
						id: nanoid(),
						libraryId,
						filePath,
						fileName: basename(filePath),
						fileSize: bunFile.size,
						modifiedAt: new Date(bunFile.lastModified),
						status: "pending",
					})
				);
				return "added";
			});

		// Phase 2: Reconcile discovered paths against DB with parallel workers.
		const reconcileFiles = (
			db: Db,
			libraryId: string,
			videoPaths: string[],
			existingByPath: Map<string, ExistingVideo>,
			concurrency: number,
			onProgress?: ProgressFn
		): Effect.Effect<{ added: number; changed: number; removed: number }> =>
			Effect.gen(function* () {
				const total = videoPaths.length;
				const activeFiles = new Set<string>();
				let processed = 0;
				let added = 0;
				let changed = 0;

				const report = (): Effect.Effect<void> => {
					const names = [...activeFiles].map((f) => basename(f)).join(", ");
					const pct = Math.round((processed / total) * 100);
					return progress(onProgress, pct, `${names} (${processed}/${total})`);
				};

				yield* Effect.forEach(
					videoPaths,
					(filePath) =>
						Effect.gen(function* () {
							activeFiles.add(filePath);
							yield* report();

							const existing = existingByPath.get(filePath);
							if (existing) {
								existingByPath.delete(filePath);
							}

							const result = yield* handleFile(
								db,
								libraryId,
								filePath,
								existing
							);
							if (result === "added") {
								added++;
							}
							if (result === "changed") {
								changed++;
							}

							processed++;
							activeFiles.delete(filePath);
							yield* report();
						}),
					{ concurrency }
				);

				const staleIds = [...existingByPath.values()].map((v) => v.id);
				if (staleIds.length > 0) {
					yield* Effect.promise(() =>
						db.delete(videoTable).where(inArray(videoTable.id, staleIds))
					);
				}

				return { added, changed, removed: staleIds.length };
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

				yield* Effect.logInfo(
					`Starting scan for library ${lib.name} (${libraryId})`
				);

				yield* Effect.promise(() =>
					db
						.update(libraryTable)
						.set({ status: "scanning" })
						.where(eq(libraryTable.id, libraryId))
				);

				// Phase 1: Walk filesystem (indefinite progress)
				const folderPaths: string[] = JSON.parse(lib.folderPaths);
				const videoPaths = yield* walkFolders(folderPaths, onProgress);

				// Load existing videos from DB
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
				const existingByPath = new Map(
					existingVideos.map((v) => [v.filePath, v])
				);

				yield* progress(
					onProgress,
					0,
					`Found ${videoPaths.length} videos. Processing...`
				);

				// Phase 2: Reconcile (definite progress)
				const { added, changed, removed } = yield* reconcileFiles(
					db,
					libraryId,
					videoPaths,
					existingByPath,
					lib.scanConcurrency,
					onProgress
				);

				yield* Effect.promise(() =>
					db
						.update(libraryTable)
						.set({
							videoCount: videoPaths.length,
							status: "idle",
						})
						.where(eq(libraryTable.id, libraryId))
				);

				yield* Effect.logInfo(
					`Scan complete for ${lib.name}: ${added} added, ${changed} changed, ${removed} removed`
				);
				yield* progress(
					onProgress,
					100,
					`Scan complete. ${added} added, ${changed} changed, ${removed} removed.`
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
					downscaleFps: ctx.downscaleFps,
					downscaleHeight: 480,
					concurrency: ctx.concurrency,
				};

				yield* progress(
					onProgress,
					0,
					`${vid.fileName} — Splitting into chunks...`
				);

				// Producer-consumer: producer creates chunks sequentially,
				// consumers process them as soon as they appear.
				// null = poison pill signalling no more chunks.
				const queue = yield* Queue.bounded<ChunkInfo | null>(ctx.concurrency);

				const {
					total: totalChunks,
					produce,
					tmpDir,
				} = yield* ffmpeg
					.chunkVideoStreamed(vid.filePath, chunkOpts, queue)
					.pipe(
						Effect.catchAll((err) =>
							Effect.logError(
								`Chunking setup failed for ${vid.fileName}: ${err}`
							).pipe(
								Effect.flatMap(() =>
									Effect.forEach(
										Array.from({ length: ctx.concurrency }),
										() => Queue.offer(queue, null),
										{ discard: true }
									)
								),
								Effect.as({
									total: 0,
									produce: Effect.void,
									tmpDir: null as string | null,
								})
							)
						)
					);

				yield* Effect.logInfo(
					`${vid.fileName}: ${totalChunks} chunks (concurrency: ${ctx.concurrency})`
				);

				let processed = 0;
				const pendingUpserts: Array<{
					chunkId: string;
					embedding: Float32Array;
				}> = [];

				// Send one null per consumer so each exits its loop
				const sendPoisonPills = Effect.forEach(
					Array.from({ length: ctx.concurrency }),
					() => Queue.offer(queue, null),
					{ discard: true }
				);

				// Producer: create chunks one at a time, push to queue
				const producer = produce.pipe(
					Effect.tap(() => sendPoisonPills),
					Effect.catchAll((err) =>
						Effect.logError(`Chunking failed for ${vid.fileName}: ${err}`).pipe(
							Effect.flatMap(() => sendPoisonPills)
						)
					)
				);

				const insertChunkRecord = (chunkInfo: ChunkInfo) =>
					Effect.promise(() =>
						db
							.insert(chunkTable)
							.values({
								id: makeChunkId(vid.id, ctx.indexerId, chunkInfo.startTime),
								videoId: vid.id,
								indexerId: ctx.indexerId,
								startTime: chunkInfo.startTime,
								endTime: chunkInfo.endTime,
								isStillFrame: false,
								embeddingStatus: "pending" as const,
							})
							.onConflictDoNothing()
					);

				const processChunk = (
					chunkInfo: ChunkInfo
				): Effect.Effect<void, JobCancelledError | Error> =>
					Effect.gen(function* () {
						yield* checkCancelled(db, ctx.jobId);

						const chunkId = makeChunkId(
							vid.id,
							ctx.indexerId,
							chunkInfo.startTime
						);

						yield* insertChunkRecord(chunkInfo);

						const chunkDuration = chunkInfo.endTime - chunkInfo.startTime;
						const still = yield* ffmpeg.isStillFrame(
							chunkInfo.chunkPath,
							chunkDuration
						);

						if (still) {
							yield* Effect.promise(() =>
								db
									.update(chunkTable)
									.set({
										isStillFrame: true,
										embeddingStatus: "skipped",
									})
									.where(eq(chunkTable.id, chunkId))
							);
							return;
						}

						const videoBytes = yield* fs
							.readFile(chunkInfo.chunkPath)
							.pipe(Effect.orDie);
						const embedding = yield* embedSvc.embedVideo(
							Buffer.from(videoBytes),
							ctx.config,
							ctx.instruction
						);
						pendingUpserts.push({
							chunkId,
							embedding: new Float32Array(embedding),
						});
					});

				const markChunkError = (
					chunkInfo: ChunkInfo,
					err: unknown
				): Effect.Effect<void> => {
					const chunkId = makeChunkId(
						vid.id,
						ctx.indexerId,
						chunkInfo.startTime
					);
					return Effect.logError(
						`Chunk error [${vid.fileName} @ ${chunkInfo.startTime}s]: ${err}`
					).pipe(
						Effect.flatMap(() =>
							Effect.promise(() =>
								db
									.update(chunkTable)
									.set({ embeddingStatus: "error" })
									.where(eq(chunkTable.id, chunkId))
							)
						),
						Effect.ignore
					);
				};

				// Consumer: pull from queue, process concurrently
				const consumer = Effect.gen(function* () {
					while (true) {
						const item = yield* Queue.take(queue).pipe(
							Effect.catchAll(() => Effect.fail("done" as const))
						);
						if (item === null) {
							break;
						}
						const chunkInfo = item;
						yield* processChunk(chunkInfo).pipe(
							Effect.timeout(Duration.minutes(5)),
							Effect.catchAll((err) => {
								if (err instanceof JobCancelledError) {
									return Queue.shutdown(queue).pipe(
										Effect.flatMap(() => Effect.fail(err))
									);
								}
								return markChunkError(chunkInfo, err);
							}),
							Effect.catchAllDefect((err) => markChunkError(chunkInfo, err)),
							Effect.tap(() => {
								processed++;
								const pct =
									totalChunks > 0
										? Math.round((processed / totalChunks) * 100)
										: 0;
								return progress(
									onProgress,
									pct,
									`${vid.fileName} — Chunk ${processed}/${totalChunks || "?"}`
								);
							})
						);
					}
				}).pipe(Effect.catchAll(() => Effect.void));

				// Run producer + N consumers concurrently
				const consumers = Array.from(
					{ length: ctx.concurrency },
					() => consumer
				);
				yield* Effect.all([producer, ...consumers], {
					concurrency: "unbounded",
				});

				// Batch upsert all embeddings to vector DB
				if (pendingUpserts.length > 0) {
					yield* ctx.vectorDb.upsertBatch(pendingUpserts).pipe(
						Effect.tap(() => {
							const embeddedIds = pendingUpserts.map((u) => u.chunkId);
							return Effect.promise(() =>
								db
									.update(chunkTable)
									.set({ embeddingStatus: "embedded" })
									.where(inArray(chunkTable.id, embeddedIds))
							);
						}),
						Effect.catchAll((err) =>
							Effect.logError(`Batch upsert failed for ${vid.fileName}: ${err}`)
						)
					);
				}

				// Clean up the entire temp directory (covers leaked files on cancel/error)
				if (tmpDir) {
					yield* fs.remove(tmpDir, { recursive: true }).pipe(Effect.ignore);
				}
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
					concurrency: emb.indexConcurrency,
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
				Effect.catchAllDefect((err) => {
					const errorMessage = err instanceof Error ? err.message : String(err);
					return Effect.logError(
						`Video processing defect [${videoId}]: ${errorMessage}`
					).pipe(
						Effect.flatMap(() =>
							Effect.promise(() =>
								db
									.update(videoTable)
									.set({ status: "error", errorMessage })
									.where(eq(videoTable.id, videoId))
							)
						),
						Effect.asVoid
					);
				})
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

				// Lazily resolve duration if not set during scan
				if (vid.duration === null) {
					const dur = yield* ffmpeg
						.getVideoDuration(vid.filePath)
						.pipe(
							Effect.catchAll((err) =>
								Effect.logWarning(
									`Duration probe failed for ${vid.fileName}: ${err}`
								).pipe(Effect.as(null))
							)
						);
					if (dur !== null) {
						yield* Effect.promise(() =>
							db
								.update(videoTable)
								.set({ duration: dur })
								.where(eq(videoTable.id, vid.id))
						);
					}
				}

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
					concurrency: emb.indexConcurrency,
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

				yield* Effect.logInfo(
					`Starting indexing for library ${libraryId} with indexer ${indexerId}`
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

				const videosToProcess = videos.filter(
					(v) => v.status === "pending" || v.status === "error"
				);

				if (videosToProcess.length === 0) {
					yield* Effect.logInfo("No pending videos to index");
					yield* progress(onProgress, 100, "No pending videos to index.");
					yield* Effect.promise(() =>
						db
							.update(libraryTable)
							.set({ status: "ready" })
							.where(eq(libraryTable.id, libraryId))
					);
					return;
				}

				yield* Effect.logInfo(
					`Indexing ${videosToProcess.length} videos (concurrency: ${indexer.concurrency})`
				);

				let processed = 0;
				const total = videosToProcess.length;

				for (const vid of videosToProcess) {
					yield* Effect.logInfo(
						`Indexing video ${processed + 1}/${total}: ${vid.fileName}`
					);

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

				yield* Effect.logInfo(
					`Indexing complete: ${processed} videos processed`
				);

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
