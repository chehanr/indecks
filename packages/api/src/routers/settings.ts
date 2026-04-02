import { settings as settingsTable } from "@indecks/db/schema/settings";
import { testConnection } from "@indecks/pipeline/embedder";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, router } from "../index";

export const settingsRouter = router({
	get: protectedProcedure.query(async ({ ctx }) => {
		const row = await ctx.db
			.select()
			.from(settingsTable)
			.where(eq(settingsTable.id, "default"))
			.get();

		return {
			embeddingBaseUrl: row?.embeddingBaseUrl ?? "",
			embeddingApiKey: row?.embeddingApiKey ?? "",
			embeddingModel: row?.embeddingModel ?? "",
			embeddingDimensions: row?.embeddingDimensions ?? 768,
		};
	}),

	update: protectedProcedure
		.input(
			z.object({
				embeddingBaseUrl: z.string().trim().min(1),
				embeddingApiKey: z.string().trim(),
				embeddingModel: z.string().trim().min(1),
				embeddingDimensions: z.number().min(1).default(768),
			})
		)
		.mutation(async ({ ctx, input }) => {
			await ctx.db
				.insert(settingsTable)
				.values({
					id: "default",
					embeddingBaseUrl: input.embeddingBaseUrl,
					embeddingApiKey: input.embeddingApiKey,
					embeddingModel: input.embeddingModel,
					embeddingDimensions: input.embeddingDimensions,
				})
				.onConflictDoUpdate({
					target: settingsTable.id,
					set: {
						embeddingBaseUrl: input.embeddingBaseUrl,
						embeddingApiKey: input.embeddingApiKey,
						embeddingModel: input.embeddingModel,
						embeddingDimensions: input.embeddingDimensions,
					},
				});

			return { success: true };
		}),

	test: protectedProcedure
		.input(
			z.object({
				embeddingBaseUrl: z.string().trim().min(1),
				embeddingApiKey: z.string().trim(),
				embeddingModel: z.string().trim().min(1),
				embeddingDimensions: z.number().min(1).default(768),
			})
		)
		.mutation(({ input }) => {
			return testConnection({
				baseUrl: input.embeddingBaseUrl,
				apiKey: input.embeddingApiKey,
				model: input.embeddingModel,
				dimensions: input.embeddingDimensions,
			});
		}),
});
