import { chunk as chunkTable } from "@indecks/db/schema/chunk";
import { library as libraryTable } from "@indecks/db/schema/library";
import { video as videoTable } from "@indecks/db/schema/video";
import type { EmbedConfig } from "@indecks/pipeline/embedder";
import { embedText } from "@indecks/pipeline/embedder";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

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
		.query(async ({ ctx, input }) => {
			const lib = await ctx.db
				.select()
				.from(libraryTable)
				.where(eq(libraryTable.id, input.libraryId))
				.get();

			if (!lib) {
				throw new Error("Library not found");
			}

			if (
				!(lib.embeddingBaseUrl && lib.embeddingModel && lib.embeddingDimensions)
			) {
				throw new Error("Library embedding not configured");
			}

			const embedConfig: EmbedConfig = {
				baseUrl: lib.embeddingBaseUrl,
				apiKey: lib.embeddingApiKey ?? "",
				model: lib.embeddingModel,
				dimensions: lib.embeddingDimensions,
			};

			const instruction = lib.embeddingInstruction ?? undefined;

			const t0 = performance.now();
			const queryEmbedding = await embedText(
				input.query,
				embedConfig,
				instruction
			);
			const embedMs = Math.round(performance.now() - t0);

			const vectorDb = ctx.vectorDbManager.get(
				input.libraryId,
				lib.embeddingDimensions
			);
			const totalVectors = vectorDb.count();

			const t1 = performance.now();
			const results = vectorDb.search(
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
			const chunks = await ctx.db
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
				.all();

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
		}),
});
