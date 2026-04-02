import { DbService } from "@indecks/db";
import { chunk as chunkTable } from "@indecks/db/schema/chunk";
import { library as libraryTable } from "@indecks/db/schema/library";
import { video as videoTable } from "@indecks/db/schema/video";
import type { EmbedConfig } from "@indecks/pipeline/embedder";
import { EmbedService } from "@indecks/pipeline/embedder";
import {
	LibraryEmbeddingNotConfiguredError,
	LibraryNotFoundError,
} from "@indecks/pipeline/errors";
import { VectorDbManagerService } from "@indecks/vector";
import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { runEffect } from "../effect-trpc";
import { protectedProcedure, router } from "../index";

export const searchRouter = router({
	query: protectedProcedure
		.input(
			z.object({
				query: z.string().min(1),
				libraryId: z.string().min(1),
				limit: z.number().min(1).max(50).default(10),
			})
		)
		.query(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					const vectorDbManager = yield* VectorDbManagerService;
					const embedSvc = yield* EmbedService;

					const lib = yield* Effect.promise(() =>
						db
							.select()
							.from(libraryTable)
							.where(eq(libraryTable.id, input.libraryId))
							.get()
					);

					if (!lib) {
						return yield* new LibraryNotFoundError({
							libraryId: input.libraryId,
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
							libraryId: input.libraryId,
						});
					}

					const embedConfig: EmbedConfig = {
						baseUrl: lib.embeddingBaseUrl,
						apiKey: lib.embeddingApiKey ?? "",
						model: lib.embeddingModel,
						dimensions: lib.embeddingDimensions,
					};

					const instruction = lib.embeddingInstruction ?? undefined;

					const t0 = performance.now();
					const queryEmbedding = yield* embedSvc.embedText(
						input.query,
						embedConfig,
						instruction
					);
					const embedMs = Math.round(performance.now() - t0);

					const vectorDb = yield* vectorDbManager.get(
						input.libraryId,
						lib.embeddingDimensions
					);
					const totalVectors = yield* vectorDb.count();

					const t1 = performance.now();
					const results = yield* vectorDb.search(
						new Float32Array(queryEmbedding),
						input.limit * 2
					);
					const searchMs = Math.round(performance.now() - t1);

					if (results.length === 0) {
						return {
							results: [],
							debug: {
								embedMs,
								searchMs,
								totalVectors,
								dimensions: queryEmbedding.length,
							},
						};
					}

					const chunkIds = results.map((r) => r.chunkId);
					const chunks = yield* Effect.promise(() =>
						db
							.select({
								chunkId: chunkTable.id,
								videoId: chunkTable.videoId,
								startTime: chunkTable.startTime,
								endTime: chunkTable.endTime,
								filePath: videoTable.filePath,
								fileName: videoTable.fileName,
								libraryId: videoTable.libraryId,
							})
							.from(chunkTable)
							.innerJoin(videoTable, eq(chunkTable.videoId, videoTable.id))
							.where(inArray(chunkTable.id, chunkIds))
							.all()
					);

					const chunkMap = new Map(chunks.map((c) => [c.chunkId, c]));

					const filtered = results
						.map((r) => {
							const chunkData = chunkMap.get(r.chunkId);
							if (!chunkData) {
								return null;
							}
							return {
								chunkId: r.chunkId,
								distance: r.distance,
								score: 1 - r.distance,
								videoId: chunkData.videoId,
								filePath: chunkData.filePath,
								fileName: chunkData.fileName,
								startTime: chunkData.startTime,
								endTime: chunkData.endTime,
								libraryId: chunkData.libraryId,
							};
						})
						.filter((r): r is NonNullable<typeof r> => r !== null)
						.slice(0, input.limit);

					return {
						results: filtered,
						debug: {
							embedMs,
							searchMs,
							totalVectors,
							dimensions: queryEmbedding.length,
						},
					};
				})
			)
		),
});
