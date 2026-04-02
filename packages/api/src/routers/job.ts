import { job as jobTable } from "@indecks/db/schema/job";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, router } from "../index";

export const jobRouter = router({
	get: protectedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const row = await ctx.db
				.select()
				.from(jobTable)
				.where(eq(jobTable.id, input.id))
				.get();
			if (!row) {
				throw new Error("Job not found");
			}
			return row;
		}),

	list: protectedProcedure
		.input(
			z.object({
				libraryId: z.string().optional(),
				limit: z.number().min(1).max(100).default(20),
			})
		)
		.query(({ ctx, input }) => {
			if (input.libraryId) {
				return ctx.db
					.select()
					.from(jobTable)
					.where(eq(jobTable.libraryId, input.libraryId))
					.orderBy(desc(jobTable.createdAt))
					.limit(input.limit)
					.all();
			}
			return ctx.db
				.select()
				.from(jobTable)
				.orderBy(desc(jobTable.createdAt))
				.limit(input.limit)
				.all();
		}),

	cancel: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			await ctx.db
				.update(jobTable)
				.set({ status: "cancelled" })
				.where(eq(jobTable.id, input.id));
			return { success: true };
		}),
});
