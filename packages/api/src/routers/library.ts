import { FileSystem } from "@effect/platform";
import { DbService } from "@indecks/db";
import { chunk as chunkTable } from "@indecks/db/schema/chunk";
import { indexer as indexerTable } from "@indecks/db/schema/indexer";
import { job as jobTable } from "@indecks/db/schema/job";
import { library as libraryTable } from "@indecks/db/schema/library";
import { video as videoTable } from "@indecks/db/schema/video";
import {
	FolderNotAccessibleError,
	IndexerNotFoundError,
	LibraryBusyError,
	LibraryNotFoundError,
	VideoNotFoundError,
} from "@indecks/pipeline/errors";
import { ThumbnailCacheService } from "@indecks/pipeline/thumbnail-cache";
import { canTransitionLibrary } from "@indecks/state/transition";
import type { LibraryStatus } from "@indecks/state/types";
import { VectorDbManagerService } from "@indecks/vector";
import { and, count, eq, inArray, like } from "drizzle-orm";
import { Effect } from "effect";
import { nanoid } from "nanoid";
import { z } from "zod";

import { runEffect } from "../effect-trpc";
import { protectedProcedure, router } from "../index";

const validateFolderPaths = (folderPaths: string[]) =>
	Effect.gen(function* () {
		const fsService = yield* FileSystem.FileSystem;
		for (const folderPath of folderPaths) {
			yield* fsService
				.access(folderPath)
				.pipe(
					Effect.catchAll(() =>
						Effect.fail(new FolderNotAccessibleError({ path: folderPath }))
					)
				);
		}
	});

export const libraryRouter = router({
	list: protectedProcedure.query(({ ctx }) =>
		runEffect(
			ctx.runtime,
			Effect.gen(function* () {
				const db = yield* DbService;
				return yield* Effect.promise(() =>
					db.select().from(libraryTable).all()
				);
			})
		)
	),

	get: protectedProcedure
		.input(z.object({ id: z.string() }))
		.query(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					const lib = yield* Effect.promise(() =>
						db
							.select()
							.from(libraryTable)
							.where(eq(libraryTable.id, input.id))
							.get()
					);
					if (!lib) {
						return yield* new LibraryNotFoundError({
							libraryId: input.id,
						});
					}
					return lib;
				})
			)
		),

	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				folderPaths: z.array(z.string().min(1)).min(1),
				scanConcurrency: z.number().min(1).max(16).default(3),
				excludePatterns: z.array(z.string()).default([]),
				scanModifiedAfter: z.string().datetime().nullable().optional(),
				scanModifiedBefore: z.string().datetime().nullable().optional(),
			})
		)
		.mutation(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					yield* validateFolderPaths(input.folderPaths);

					const id = nanoid();
					yield* Effect.promise(() =>
						db.insert(libraryTable).values({
							id,
							name: input.name,
							folderPaths: JSON.stringify(input.folderPaths),
							scanConcurrency: input.scanConcurrency,
							excludePatterns: JSON.stringify(input.excludePatterns),
							scanModifiedAfter: input.scanModifiedAfter
								? new Date(input.scanModifiedAfter)
								: null,
							scanModifiedBefore: input.scanModifiedBefore
								? new Date(input.scanModifiedBefore)
								: null,
						})
					);

					return { id };
				})
			)
		),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				name: z.string().min(1).optional(),
				folderPaths: z.array(z.string().min(1)).min(1).optional(),
				scanConcurrency: z.number().min(1).max(16).optional(),
				excludePatterns: z.array(z.string()).optional(),
				scanModifiedAfter: z.string().datetime().nullable().optional(),
				scanModifiedBefore: z.string().datetime().nullable().optional(),
			})
		)
		.mutation(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					const { id, ...fields } = input;
					const set: Record<string, unknown> = {};

					if (fields.name !== undefined) {
						set.name = fields.name;
					}
					if (fields.folderPaths !== undefined) {
						yield* validateFolderPaths(fields.folderPaths);
						set.folderPaths = JSON.stringify(fields.folderPaths);
					}
					if (fields.scanConcurrency !== undefined) {
						set.scanConcurrency = fields.scanConcurrency;
					}
					if (fields.excludePatterns !== undefined) {
						set.excludePatterns = JSON.stringify(fields.excludePatterns);
					}
					if (fields.scanModifiedAfter !== undefined) {
						set.scanModifiedAfter = fields.scanModifiedAfter
							? new Date(fields.scanModifiedAfter)
							: null;
					}
					if (fields.scanModifiedBefore !== undefined) {
						set.scanModifiedBefore = fields.scanModifiedBefore
							? new Date(fields.scanModifiedBefore)
							: null;
					}

					yield* Effect.promise(() =>
						db.update(libraryTable).set(set).where(eq(libraryTable.id, id))
					);

					return { success: true };
				})
			)
		),

	delete: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					const vectorDbManager = yield* VectorDbManagerService;
					const thumbCache = yield* ThumbnailCacheService;

					const videos = yield* Effect.promise(() =>
						db
							.select({ filePath: videoTable.filePath })
							.from(videoTable)
							.where(eq(videoTable.libraryId, input.id))
							.all()
					);

					yield* vectorDbManager.remove(input.id);
					yield* Effect.promise(() =>
						db.delete(libraryTable).where(eq(libraryTable.id, input.id))
					);

					if (videos.length > 0) {
						yield* thumbCache.removeByPaths(videos.map((v) => v.filePath));
					}

					return { success: true };
				})
			)
		),

	startScan: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;

					const lib = yield* Effect.promise(() =>
						db
							.select()
							.from(libraryTable)
							.where(eq(libraryTable.id, input.id))
							.get()
					);

					if (!lib) {
						return yield* new LibraryNotFoundError({
							libraryId: input.id,
						});
					}

					if (
						!canTransitionLibrary(lib.status as LibraryStatus, {
							type: "START_SCAN",
						})
					) {
						return yield* new LibraryBusyError({
							libraryId: input.id,
							currentStatus: lib.status,
						});
					}

					yield* Effect.promise(() =>
						db
							.update(libraryTable)
							.set({ status: "scanning" })
							.where(eq(libraryTable.id, input.id))
					);

					const jobId = nanoid();
					yield* Effect.promise(() =>
						db.insert(jobTable).values({
							id: jobId,
							type: "scan_library",
							libraryId: input.id,
							status: "pending",
						})
					);

					return { jobId };
				})
			)
		),

	startIndexing: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				indexerId: z.string().min(1),
				force: z.boolean().optional(),
			})
		)
		.mutation(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					const vectorDbManager = yield* VectorDbManagerService;

					const lib = yield* Effect.promise(() =>
						db
							.select()
							.from(libraryTable)
							.where(eq(libraryTable.id, input.id))
							.get()
					);

					if (!lib) {
						return yield* new LibraryNotFoundError({
							libraryId: input.id,
						});
					}

					const emb = yield* Effect.promise(() =>
						db
							.select()
							.from(indexerTable)
							.where(eq(indexerTable.id, input.indexerId))
							.get()
					);

					if (!emb) {
						return yield* new IndexerNotFoundError({
							indexerId: input.indexerId,
						});
					}

					if (
						!canTransitionLibrary(lib.status as LibraryStatus, {
							type: "START_INDEXING",
						})
					) {
						return yield* new LibraryBusyError({
							libraryId: input.id,
							currentStatus: lib.status,
						});
					}

					if (input.force) {
						yield* Effect.promise(() =>
							db
								.delete(chunkTable)
								.where(
									and(
										eq(chunkTable.indexerId, input.indexerId),
										inArray(
											chunkTable.videoId,
											db
												.select({ id: videoTable.id })
												.from(videoTable)
												.where(eq(videoTable.libraryId, input.id))
										)
									)
								)
						);

						yield* vectorDbManager
							.remove(input.id, input.indexerId)
							.pipe(Effect.orDie);

						yield* Effect.promise(() =>
							db
								.update(videoTable)
								.set({ status: "pending", errorMessage: null })
								.where(eq(videoTable.libraryId, input.id))
						);
					}

					yield* Effect.promise(() =>
						db
							.update(libraryTable)
							.set({ status: "indexing" })
							.where(eq(libraryTable.id, input.id))
					);

					const jobId = nanoid();
					yield* Effect.promise(() =>
						db.insert(jobTable).values({
							id: jobId,
							type: "index_library",
							libraryId: input.id,
							indexerId: input.indexerId,
							status: "pending",
						})
					);

					return { jobId };
				})
			)
		),

	reindexVideo: protectedProcedure
		.input(z.object({ videoId: z.string(), indexerId: z.string().min(1) }))
		.mutation(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					const vectorDbManager = yield* VectorDbManagerService;

					const vid = yield* Effect.promise(() =>
						db
							.select()
							.from(videoTable)
							.where(eq(videoTable.id, input.videoId))
							.get()
					);

					if (!vid) {
						return yield* new VideoNotFoundError({
							videoId: input.videoId,
						});
					}

					const emb = yield* Effect.promise(() =>
						db
							.select()
							.from(indexerTable)
							.where(eq(indexerTable.id, input.indexerId))
							.get()
					);

					if (!emb) {
						return yield* new IndexerNotFoundError({
							indexerId: input.indexerId,
						});
					}

					const chunks = yield* Effect.promise(() =>
						db
							.select({ id: chunkTable.id })
							.from(chunkTable)
							.where(
								and(
									eq(chunkTable.videoId, input.videoId),
									eq(chunkTable.indexerId, input.indexerId)
								)
							)
							.all()
					);

					if (chunks.length > 0) {
						const vectorDb = yield* vectorDbManager.get(
							vid.libraryId,
							emb.id,
							emb.dimensions
						);
						yield* vectorDb.removeByChunkIds(chunks.map((c) => c.id));
						yield* Effect.promise(() =>
							db
								.delete(chunkTable)
								.where(
									and(
										eq(chunkTable.videoId, input.videoId),
										eq(chunkTable.indexerId, input.indexerId)
									)
								)
						);
					}

					yield* Effect.promise(() =>
						db
							.update(videoTable)
							.set({ status: "pending", errorMessage: null })
							.where(eq(videoTable.id, input.videoId))
					);

					const jobId = nanoid();
					yield* Effect.promise(() =>
						db.insert(jobTable).values({
							id: jobId,
							type: "index_video",
							videoId: input.videoId,
							libraryId: vid.libraryId,
							indexerId: input.indexerId,
							status: "pending",
						})
					);

					return { jobId };
				})
			)
		),

	video: protectedProcedure
		.input(z.object({ id: z.string() }))
		.query(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					const row = yield* Effect.promise(() =>
						db
							.select()
							.from(videoTable)
							.where(eq(videoTable.id, input.id))
							.get()
					);
					if (!row) {
						return yield* new VideoNotFoundError({ videoId: input.id });
					}
					return row;
				})
			)
		),

	videos: protectedProcedure
		.input(
			z.object({
				libraryId: z.string(),
				search: z.string().optional(),
				limit: z.number().min(1).max(100).default(20),
				offset: z.number().min(0).default(0),
			})
		)
		.query(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;

					const conditions = [eq(videoTable.libraryId, input.libraryId)];
					if (input.search) {
						conditions.push(like(videoTable.fileName, `%${input.search}%`));
					}
					const whereClause = and(...conditions);

					const [totalResult] = yield* Effect.promise(() =>
						db
							.select({ count: count() })
							.from(videoTable)
							.where(whereClause)
							.all()
					);
					const total = totalResult?.count ?? 0;

					const videos = yield* Effect.promise(() =>
						db
							.select()
							.from(videoTable)
							.where(whereClause)
							.limit(input.limit)
							.offset(input.offset)
							.all()
					);

					const chunkCounts = yield* Effect.promise(() =>
						db
							.select({
								videoId: chunkTable.videoId,
								indexerId: chunkTable.indexerId,
							})
							.from(chunkTable)
							.where(eq(chunkTable.embeddingStatus, "embedded"))
							.all()
					);

					const indexers = yield* Effect.promise(() =>
						db
							.select({ id: indexerTable.id, name: indexerTable.name })
							.from(indexerTable)
							.where(eq(indexerTable.libraryId, input.libraryId))
							.all()
					);
					const indexerNames = new Map(indexers.map((e) => [e.id, e.name]));

					const videoIndexers = new Map<string, string[]>();
					for (const row of chunkCounts) {
						const name = indexerNames.get(row.indexerId);
						if (!name) {
							continue;
						}
						const list = videoIndexers.get(row.videoId) ?? [];
						if (!list.includes(name)) {
							list.push(name);
						}
						videoIndexers.set(row.videoId, list);
					}

					return {
						items: videos.map((v) => ({
							...v,
							indexedBy: videoIndexers.get(v.id) ?? [],
						})),
						total,
					};
				})
			)
		),
});
