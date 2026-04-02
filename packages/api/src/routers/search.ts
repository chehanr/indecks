import { chunk as chunkTable } from "@indecks/db/schema/chunk";
import { library as libraryTable } from "@indecks/db/schema/library";
import { settings as settingsTable } from "@indecks/db/schema/settings";
import { video as videoTable } from "@indecks/db/schema/video";
import type { EmbedConfig } from "@indecks/pipeline/embedder";
import { embedText } from "@indecks/pipeline/embedder";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Context } from "../context";
import { protectedProcedure, router } from "../index";

async function getEmbedConfig(db: Context["db"]): Promise<EmbedConfig | null> {
	const row = await db
		.select()
		.from(settingsTable)
		.where(eq(settingsTable.id, "default"))
		.get();

	if (row?.embeddingBaseUrl && row.embeddingModel) {
		return {
			baseUrl: row.embeddingBaseUrl,
			apiKey: row.embeddingApiKey ?? "",
			model: row.embeddingModel,
			dimensions: row.embeddingDimensions,
		};
	}

	const baseUrl = process.env.EMBEDDING_API_BASE_URL;
	const model = process.env.EMBEDDING_MODEL;
	if (!(baseUrl && model)) {
		return null;
	}

	return {
		baseUrl,
		apiKey: process.env.EMBEDDING_API_KEY ?? "",
		model,
		dimensions: row?.embeddingDimensions ?? 768,
	};
}

export const searchRouter = router({
	query: protectedProcedure
		.input(
			z.object({
				query: z.string().min(1),
				libraryId: z.string().optional(),
				limit: z.number().min(1).max(50).default(10),
			})
		)
		.query(async ({ ctx, input }) => {
			const embedConfig = await getEmbedConfig(ctx.db);
			if (!embedConfig) {
				throw new Error("Embedding API not configured");
			}

			let instruction: string | undefined;
			if (input.libraryId) {
				const lib = await ctx.db
					.select({ embeddingInstruction: libraryTable.embeddingInstruction })
					.from(libraryTable)
					.where(eq(libraryTable.id, input.libraryId))
					.get();
				instruction = lib?.embeddingInstruction ?? undefined;
			}

			const t0 = performance.now();
			const queryEmbedding = await embedText(
				input.query,
				embedConfig,
				instruction
			);
			const embedMs = Math.round(performance.now() - t0);

			const totalVectors = ctx.vectorDb.count();

			const t1 = performance.now();
			const results = ctx.vectorDb.search(
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
					if (input.libraryId && chunkData.libraryId !== input.libraryId) {
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
