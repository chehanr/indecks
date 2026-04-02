import { access } from "node:fs/promises";
import { DbService } from "@indecks/db";
import { chunk as chunkTable } from "@indecks/db/schema/chunk";
import { job as jobTable } from "@indecks/db/schema/job";
import { library as libraryTable } from "@indecks/db/schema/library";
import { video as videoTable } from "@indecks/db/schema/video";
import { EmbedService } from "@indecks/pipeline/embedder";
import {
	FolderNotAccessibleError,
	LibraryEmbeddingNotConfiguredError,
	LibraryNotFoundError,
	VideoNotFoundError,
} from "@indecks/pipeline/errors";
import { VectorDbManagerService } from "@indecks/vector";
import { eq } from "drizzle-orm";
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
				folderPath: z.string().min(1),
				embeddingInstruction: z.string().trim().optional(),
				embeddingBaseUrl: z.string().trim().min(1),
				embeddingApiKey: z.string().trim().optional(),
				embeddingModel: z.string().trim().min(1),
				embeddingDimensions: z.number().min(1),
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

					yield* Effect.tryPromise({
						try: () => access(input.folderPath),
						catch: () =>
							new FolderNotAccessibleError({
								path: input.folderPath,
							}),
					});

					const id = nanoid();
					yield* Effect.promise(() =>
						db.insert(libraryTable).values({
							id,
							name: input.name,
							folderPath: input.folderPath,
							embeddingInstruction: input.embeddingInstruction || null,
							embeddingBaseUrl: input.embeddingBaseUrl,
							embeddingApiKey: input.embeddingApiKey || null,
							embeddingModel: input.embeddingModel,
							embeddingDimensions: input.embeddingDimensions,
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
				embeddingInstruction: z.string().trim().optional(),
				embeddingBaseUrl: z.string().trim().min(1).optional(),
				embeddingApiKey: z.string().trim().optional(),
				embeddingModel: z.string().trim().min(1).optional(),
				embeddingDimensions: z.number().min(1).optional(),
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
					const set: Record<string, unknown> = {};

					if (fields.embeddingInstruction !== undefined) {
						set.embeddingInstruction = fields.embeddingInstruction || null;
					}
					if (fields.embeddingBaseUrl !== undefined) {
						set.embeddingBaseUrl = fields.embeddingBaseUrl;
					}
					if (fields.embeddingApiKey !== undefined) {
						set.embeddingApiKey = fields.embeddingApiKey || null;
					}
					if (fields.embeddingModel !== undefined) {
						set.embeddingModel = fields.embeddingModel;
					}
					if (fields.embeddingDimensions !== undefined) {
						set.embeddingDimensions = fields.embeddingDimensions;
					}
					if (fields.chunkDuration !== undefined) {
						set.chunkDuration = fields.chunkDuration;
					}
					if (fields.chunkOverlap !== undefined) {
						set.chunkOverlap = fields.chunkOverlap;
					}
					if (fields.downscaleFps !== undefined) {
						set.downscaleFps = fields.downscaleFps;
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

	startIndexing: protectedProcedure
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
						!(
							lib.embeddingBaseUrl &&
							lib.embeddingModel &&
							lib.embeddingDimensions
						)
					) {
						return yield* new LibraryEmbeddingNotConfiguredError({
							libraryId: input.id,
						});
					}

					const jobId = nanoid();
					yield* Effect.promise(() =>
						db.insert(jobTable).values({
							id: jobId,
							type: "index_library",
							libraryId: input.id,
							status: "pending",
						})
					);

					return { jobId };
				})
			)
		),

	reindexVideo: protectedProcedure
		.input(z.object({ videoId: z.string() }))
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

					const lib = yield* Effect.promise(() =>
						db
							.select()
							.from(libraryTable)
							.where(eq(libraryTable.id, vid.libraryId))
							.get()
					);

					if (!lib?.embeddingDimensions) {
						return yield* new LibraryEmbeddingNotConfiguredError({
							libraryId: vid.libraryId,
						});
					}

					const chunks = yield* Effect.promise(() =>
						db
							.select({ id: chunkTable.id })
							.from(chunkTable)
							.where(eq(chunkTable.videoId, input.videoId))
							.all()
					);

					const chunkIds = chunks.map((c) => c.id);
					if (chunkIds.length > 0) {
						const vectorDb = yield* vectorDbManager.get(
							vid.libraryId,
							lib.embeddingDimensions
						);
						yield* vectorDb.removeByChunkIds(chunkIds);
						yield* Effect.promise(() =>
							db.delete(chunkTable).where(eq(chunkTable.videoId, input.videoId))
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
					return yield* Effect.promise(() =>
						db
							.select()
							.from(videoTable)
							.where(eq(videoTable.libraryId, input.libraryId))
							.all()
					);
				})
			)
		),

	testEmbedding: protectedProcedure
		.input(
			z.object({
				embeddingBaseUrl: z.string().trim().min(1),
				embeddingApiKey: z.string().trim(),
				embeddingModel: z.string().trim().min(1),
				embeddingDimensions: z.number().min(1).default(768),
			})
		)
		.mutation(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const embedSvc = yield* EmbedService;
					return yield* embedSvc.testConnection({
						baseUrl: input.embeddingBaseUrl,
						apiKey: input.embeddingApiKey,
						model: input.embeddingModel,
						dimensions: input.embeddingDimensions,
					});
				})
			)
		),
});
