import { DbService } from "@indecks/db";
import { embedder as embedderTable } from "@indecks/db/schema/embedder";
import { EmbedService } from "@indecks/pipeline/embedder";
import { EmbedderNotFoundError } from "@indecks/pipeline/errors";
import { VectorDbManagerService } from "@indecks/vector";
import { and, eq, ne } from "drizzle-orm";
import { Effect } from "effect";
import { nanoid } from "nanoid";
import { z } from "zod";

import { runEffect } from "../effect-trpc";
import { protectedProcedure, router } from "../index";

export const embedderRouter = router({
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
							.from(embedderTable)
							.where(eq(embedderTable.libraryId, input.libraryId))
							.all()
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
					const row = yield* Effect.promise(() =>
						db
							.select()
							.from(embedderTable)
							.where(eq(embedderTable.id, input.id))
							.get()
					);
					if (!row) {
						return yield* new EmbedderNotFoundError({
							embedderId: input.id,
						});
					}
					return row;
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
				chunkOverlap: z.number().min(0).default(5),
				downscaleFps: z.number().min(1).default(5),
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
								.update(embedderTable)
								.set({ isDefault: false })
								.where(eq(embedderTable.libraryId, input.libraryId))
						);
					}

					yield* Effect.promise(() =>
						db.insert(embedderTable).values({
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
			})
		)
		.mutation(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					const { id, ...fields } = input;

					const existing = yield* Effect.promise(() =>
						db
							.select()
							.from(embedderTable)
							.where(eq(embedderTable.id, id))
							.get()
					);
					if (!existing) {
						return yield* new EmbedderNotFoundError({ embedderId: id });
					}

					if (fields.isDefault) {
						yield* Effect.promise(() =>
							db
								.update(embedderTable)
								.set({ isDefault: false })
								.where(
									and(
										eq(embedderTable.libraryId, existing.libraryId),
										ne(embedderTable.id, id)
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
						db.update(embedderTable).set(set).where(eq(embedderTable.id, id))
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
							.from(embedderTable)
							.where(eq(embedderTable.id, input.id))
							.get()
					);
					if (!existing) {
						return yield* new EmbedderNotFoundError({
							embedderId: input.id,
						});
					}

					yield* vectorDbManager.remove(existing.libraryId, existing.id);

					yield* Effect.promise(() =>
						db.delete(embedderTable).where(eq(embedderTable.id, input.id))
					);

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
