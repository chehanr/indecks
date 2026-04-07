import { DbService } from "@indecks/db";
import { chunk as chunkTable } from "@indecks/db/schema/chunk";
import { indexer as indexerTable } from "@indecks/db/schema/indexer";
import { video as videoTable } from "@indecks/db/schema/video";
import { EmbedService } from "@indecks/pipeline/embedder";
import { IndexerNotFoundError } from "@indecks/pipeline/errors";
import { canTransitionVideo } from "@indecks/state/transition";
import type { VideoStatus } from "@indecks/state/types";
import { VectorDbManagerService } from "@indecks/vector";
import { and, eq, inArray, ne } from "drizzle-orm";
import { Effect } from "effect";
import { nanoid } from "nanoid";
import { z } from "zod";

import { runEffect } from "../effect-trpc";
import { protectedProcedure, router } from "../index";

export const indexerRouter = router({
	list: protectedProcedure
		.input(z.object({ libraryId: z.string() }))
		.query(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					return yield* Effect.promise(() =>
						db
							.select()
							.from(indexerTable)
							.where(eq(indexerTable.libraryId, input.libraryId))
							.all()
					);
				})
			)
		),

	create: protectedProcedure
		.input(
			z.object({
				libraryId: z.string().min(1),
				name: z.string().min(1),
				baseUrl: z.string().trim().min(1),
				apiKey: z.string().trim().optional(),
				model: z.string().trim().min(1),
				dimensions: z.number().min(1),
				instruction: z.string().trim().optional(),
				isDefault: z.boolean().default(false),
				chunkDuration: z.number().min(1).default(30),
				chunkOverlap: z.number().min(0).default(0),
				downscaleFps: z.number().min(1).default(1),
				indexConcurrency: z.number().min(1).max(16).default(3),
			})
		)
		.mutation(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					const id = nanoid();

					if (input.isDefault) {
						yield* Effect.promise(() =>
							db
								.update(indexerTable)
								.set({ isDefault: false })
								.where(eq(indexerTable.libraryId, input.libraryId))
						);
					}

					yield* Effect.promise(() =>
						db.insert(indexerTable).values({
							id,
							libraryId: input.libraryId,
							name: input.name,
							baseUrl: input.baseUrl,
							apiKey: input.apiKey || null,
							model: input.model,
							dimensions: input.dimensions,
							instruction: input.instruction || null,
							isDefault: input.isDefault,
							chunkDuration: input.chunkDuration,
							chunkOverlap: input.chunkOverlap,
							downscaleFps: input.downscaleFps,
							indexConcurrency: input.indexConcurrency,
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
				baseUrl: z.string().trim().min(1).optional(),
				apiKey: z.string().trim().optional(),
				model: z.string().trim().min(1).optional(),
				dimensions: z.number().min(1).optional(),
				instruction: z.string().trim().optional(),
				isDefault: z.boolean().optional(),
				chunkDuration: z.number().min(1).optional(),
				chunkOverlap: z.number().min(0).optional(),
				downscaleFps: z.number().min(1).optional(),
				indexConcurrency: z.number().min(1).max(16).optional(),
			})
		)
		.mutation(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					const { id, ...fields } = input;

					const existing = yield* Effect.promise(() =>
						db.select().from(indexerTable).where(eq(indexerTable.id, id)).get()
					);
					if (!existing) {
						return yield* new IndexerNotFoundError({ indexerId: id });
					}

					if (fields.isDefault) {
						yield* Effect.promise(() =>
							db
								.update(indexerTable)
								.set({ isDefault: false })
								.where(
									and(
										eq(indexerTable.libraryId, existing.libraryId),
										ne(indexerTable.id, id)
									)
								)
						);
					}

					const nullableKeys = new Set(["apiKey", "instruction"]);
					const set: Record<string, unknown> = {};
					for (const [key, value] of Object.entries(fields)) {
						if (value !== undefined) {
							set[key] = nullableKeys.has(key) ? value || null : value;
						}
					}

					yield* Effect.promise(() =>
						db.update(indexerTable).set(set).where(eq(indexerTable.id, id))
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

					const existing = yield* Effect.promise(() =>
						db
							.select()
							.from(indexerTable)
							.where(eq(indexerTable.id, input.id))
							.get()
					);
					if (!existing) {
						return yield* new IndexerNotFoundError({
							indexerId: input.id,
						});
					}

					// Find videos that have chunks from this indexer
					const affectedVideos = yield* Effect.promise(() =>
						db
							.selectDistinct({ videoId: chunkTable.videoId })
							.from(chunkTable)
							.where(eq(chunkTable.indexerId, input.id))
							.all()
					);

					yield* vectorDbManager.remove(existing.libraryId, existing.id);

					// Cascade delete removes chunks for this indexer
					yield* Effect.promise(() =>
						db.delete(indexerTable).where(eq(indexerTable.id, input.id))
					);

					// Reset videos that no longer have any embedded chunks
					if (affectedVideos.length > 0) {
						const videoIds = affectedVideos.map((v) => v.videoId);
						const remainingChunks = yield* Effect.promise(() =>
							db
								.selectDistinct({ videoId: chunkTable.videoId })
								.from(chunkTable)
								.where(
									and(
										inArray(chunkTable.videoId, videoIds),
										eq(chunkTable.embeddingStatus, "embedded")
									)
								)
								.all()
						);
						const stillIndexed = new Set(remainingChunks.map((c) => c.videoId));
						const orphanedIds = videoIds.filter((id) => !stillIndexed.has(id));
						if (orphanedIds.length > 0) {
							const orphanedVideos = yield* Effect.promise(() =>
								db
									.select({ id: videoTable.id, status: videoTable.status })
									.from(videoTable)
									.where(inArray(videoTable.id, orphanedIds))
									.all()
							);
							const resettableIds = orphanedVideos
								.filter((v) =>
									canTransitionVideo(v.status as VideoStatus, {
										type: "RESET",
									})
								)
								.map((v) => v.id);
							if (resettableIds.length > 0) {
								yield* Effect.promise(() =>
									db
										.update(videoTable)
										.set({ status: "pending", errorMessage: null })
										.where(inArray(videoTable.id, resettableIds))
								);
							}
						}
					}

					return { success: true };
				})
			)
		),

	test: protectedProcedure
		.input(
			z.object({
				baseUrl: z.string().trim().min(1),
				apiKey: z.string().trim(),
				model: z.string().trim().min(1),
				dimensions: z.number().min(1).default(768),
			})
		)
		.mutation(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const embedSvc = yield* EmbedService;
					return yield* embedSvc.testConnection({
						baseUrl: input.baseUrl,
						apiKey: input.apiKey,
						model: input.model,
						dimensions: input.dimensions,
					});
				})
			)
		),
});
