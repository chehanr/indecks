import { DbService } from "@indecks/db";
import { chunk as chunkTable } from "@indecks/db/schema/chunk";
import { indexer as indexerTable } from "@indecks/db/schema/indexer";
import { video as videoTable } from "@indecks/db/schema/video";
import type { EmbedConfig } from "@indecks/pipeline/embedder";
import { EmbedService } from "@indecks/pipeline/embedder";
import {
	IndexerNotFoundError,
	LibraryEmbeddingNotConfiguredError,
} from "@indecks/pipeline/errors";
import { VectorDbManagerService } from "@indecks/vector";
import { and, eq, inArray } from "drizzle-orm";
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
				indexerId: z.string().optional(),
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

					let emb: typeof indexerTable.$inferSelect | undefined;

					if (input.indexerId) {
						const indexerId = input.indexerId;
						const row = yield* Effect.promise(() =>
							db
								.select()
								.from(indexerTable)
								.where(
									and(
										eq(indexerTable.id, indexerId),
										eq(indexerTable.libraryId, input.libraryId)
									)
								)
								.get()
						);
						if (!row) {
							return yield* new IndexerNotFoundError({
								indexerId,
							});
						}
						emb = row;
					} else {
						const row = yield* Effect.promise(() =>
							db
								.select()
								.from(indexerTable)
								.where(
									and(
										eq(indexerTable.libraryId, input.libraryId),
										eq(indexerTable.isDefault, true)
									)
								)
								.get()
						);
						if (row) {
							emb = row;
						} else {
							const first = yield* Effect.promise(() =>
								db
									.select()
									.from(indexerTable)
									.where(eq(indexerTable.libraryId, input.libraryId))
									.limit(1)
									.get()
							);
							if (!first) {
								return yield* new LibraryEmbeddingNotConfiguredError({
									libraryId: input.libraryId,
								});
							}
							emb = first;
						}
					}

					const embedConfig: EmbedConfig = {
						baseUrl: emb.baseUrl,
						apiKey: emb.apiKey ?? "",
						model: emb.model,
						dimensions: emb.dimensions,
					};

					const instruction = emb.instruction ?? undefined;

					const t0 = performance.now();
					const queryEmbedding = yield* embedSvc.embedText(
						input.query,
						embedConfig,
						instruction
					);
					const embedMs = Math.round(performance.now() - t0);

					const vectorDb = yield* vectorDbManager.get(
						input.libraryId,
						emb.id,
						emb.dimensions
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
								indexerId: emb.id,
								indexerName: emb.name,
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
							indexerId: emb.id,
							indexerName: emb.name,
						},
					};
				})
			)
		),
});
