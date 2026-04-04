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
	LibraryNotFoundError,
	VideoNotFoundError,
} from "@indecks/pipeline/errors";
import { VectorDbManagerService } from "@indecks/vector";
import { and, eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { nanoid } from "nanoid";
import { z } from "zod";

import { runEffect } from "../effect-trpc";
import { protectedProcedure, router } from "../index";

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
			})
		)
		.mutation(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;

					const fsService = yield* FileSystem.FileSystem;
					for (const folderPath of input.folderPaths) {
						yield* fsService.access(folderPath).pipe(
							Effect.catchAll(() =>
								Effect.fail(
									new FolderNotAccessibleError({
										path: folderPath,
									})
								)
							)
						);
					}

					const id = nanoid();
					yield* Effect.promise(() =>
						db.insert(libraryTable).values({
							id,
							name: input.name,
							folderPaths: JSON.stringify(input.folderPaths),
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
						const fsService = yield* FileSystem.FileSystem;
						for (const folderPath of fields.folderPaths) {
							yield* fsService.access(folderPath).pipe(
								Effect.catchAll(() =>
									Effect.fail(
										new FolderNotAccessibleError({
											path: folderPath,
										})
									)
								)
							);
						}
						set.folderPaths = JSON.stringify(fields.folderPaths);
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
					yield* vectorDbManager.remove(input.id);
					yield* Effect.promise(() =>
						db.delete(libraryTable).where(eq(libraryTable.id, input.id))
					);
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

	videos: protectedProcedure
		.input(z.object({ libraryId: z.string() }))
		.query(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					const videos = yield* Effect.promise(() =>
						db
							.select()
							.from(videoTable)
							.where(eq(videoTable.libraryId, input.libraryId))
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

					return videos.map((v) => ({
						...v,
						indexedBy: videoIndexers.get(v.id) ?? [],
					}));
				})
			)
		),
});
