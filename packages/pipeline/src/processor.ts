import { createHash } from "node:crypto";
import { stat, unlink } from "node:fs/promises";

import type { Db } from "@indecks/db";
import { chunk as chunkTable } from "@indecks/db/schema/chunk";
import { library as libraryTable } from "@indecks/db/schema/library";
import { video as videoTable } from "@indecks/db/schema/video";
import type { VectorDb } from "@indecks/vector";
import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { nanoid } from "nanoid";

import type { EmbedConfig } from "./embedder";
import { EmbedService } from "./embedder";
import { LibraryNotFoundError, VideoNotFoundError } from "./errors";
import { FFmpegService } from "./ffmpeg";

type ProgressFn = (progress: number, message: string) => Effect.Effect<void>;

const makeChunkId = (videoId: string, startTime: number): string => {
	const raw = `${videoId}:${startTime}`;
	return createHash("sha256").update(raw).digest("hex").slice(0, 16);
};

export interface ProcessorServiceShape {
	readonly indexLibrary: (
		db: Db,
		vectorDb: VectorDb,
		libraryId: string,
		embedConfig: EmbedConfig,
		onProgress?: ProgressFn
	) => Effect.Effect<void, LibraryNotFoundError>;
	readonly processVideo: (
		db: Db,
		vectorDb: VectorDb,
		videoId: string,
		embedConfig: EmbedConfig,
		onProgress?: ProgressFn,
		instruction?: string,
		chunkOptions?: { chunkDuration?: number; overlap?: number },
		downscaleFps?: number
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
					const fileStat = yield* Effect.promise(() => stat(filePath));
					const duration = yield* ffmpeg
						.getVideoDuration(filePath)
						.pipe(Effect.option);

					yield* Effect.promise(() =>
						db.insert(videoTable).values({
							id: nanoid(),
							libraryId,
							filePath,
							fileName,
							fileSize: fileStat.size,
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

		const processVideo = (
			db: Db,
			vectorDb: VectorDb,
			videoId: string,
			embedConfig: EmbedConfig,
			onProgress?: ProgressFn,
			instruction?: string,
			chunkOptions?: { chunkDuration?: number; overlap?: number },
			downscaleFps?: number
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

				yield* Effect.promise(() =>
					db
						.update(videoTable)
						.set({ status: "processing" })
						.where(eq(videoTable.id, videoId))
				);

				const chunks = yield* ffmpeg
					.chunkVideo(vid.filePath, chunkOptions)
					.pipe(Effect.catchAll(() => Effect.succeed([])));

				yield* progress(onProgress, 0, `Chunking ${vid.fileName}...`);

				const totalChunks = chunks.length;
				let processed = 0;

				yield* Effect.forEach(
					chunks,
					(chunkInfo) =>
						Effect.gen(function* () {
							const chunkId = makeChunkId(videoId, chunkInfo.startTime);
							const still = yield* ffmpeg.isStillFrame(chunkInfo.chunkPath);

							yield* Effect.promise(() =>
								db
									.insert(chunkTable)
									.values({
										id: chunkId,
										videoId,
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
									fps: downscaleFps,
								})
								.pipe(Effect.catchAll(() => Effect.succeed(null)));

							if (downscaledPath) {
								const videoFile = Bun.file(downscaledPath);
								const videoBuffer = Buffer.from(
									yield* Effect.promise(() => videoFile.arrayBuffer())
								);

								const embeddingResult = yield* embedSvc
									.embedVideo(videoBuffer, embedConfig, instruction)
									.pipe(Effect.either);

								if (embeddingResult._tag === "Right") {
									yield* vectorDb
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

								yield* Effect.promise(() =>
									unlink(downscaledPath).catch(() => undefined)
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
			vectorDb: VectorDb,
			libraryId: string,
			embedConfig: EmbedConfig,
			onProgress?: ProgressFn
		): Effect.Effect<void, LibraryNotFoundError> =>
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

				const instruction = lib.embeddingInstruction ?? undefined;
				const chunkOpts = {
					chunkDuration: lib.chunkDuration,
					overlap: lib.chunkOverlap,
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

				const pendingVideos = videos.filter((v) => v.status === "pending");
				let processed = 0;

				for (const vid of pendingVideos) {
					yield* processVideo(
						db,
						vectorDb,
						vid.id,
						embedConfig,
						onProgress
							? (pct, msg) => {
									const overallPct = Math.round(
										((processed + pct / 100) / pendingVideos.length) * 100
									);
									return progress(
										onProgress,
										overallPct,
										`Video ${processed + 1}/${pendingVideos.length}: ${msg}`
									);
								}
							: undefined,
						instruction,
						chunkOpts,
						lib.downscaleFps
					).pipe(Effect.catchTag("VideoNotFoundError", () => Effect.void));
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
