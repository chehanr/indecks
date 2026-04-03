import { DbService } from "@indecks/db";
import { RecordNotFoundError } from "@indecks/db/errors";
import { job as jobTable } from "@indecks/db/schema/job";
import { desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { z } from "zod";

import { runEffect } from "../effect-trpc";
import { jobEvents } from "../events";
import { protectedProcedure, publicProcedure, router } from "../index";

export const jobRouter = router({
	get: protectedProcedure
		.input(z.object({ id: z.string() }))
		.query(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					const row = yield* Effect.promise(() =>
						db.select().from(jobTable).where(eq(jobTable.id, input.id)).get()
					);
					if (!row) {
						return yield* new RecordNotFoundError({
							entity: "Job",
							id: input.id,
						});
					}
					return row;
				})
			)
		),

	list: protectedProcedure
		.input(
			z.object({
				libraryId: z.string().optional(),
				limit: z.number().min(1).max(100).default(20),
			})
		)
		.query(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					if (input.libraryId) {
						const libraryId = input.libraryId;
						return yield* Effect.promise(() =>
							db
								.select()
								.from(jobTable)
								.where(eq(jobTable.libraryId, libraryId))
								.orderBy(desc(jobTable.createdAt))
								.limit(input.limit)
								.all()
						);
					}
					return yield* Effect.promise(() =>
						db
							.select()
							.from(jobTable)
							.orderBy(desc(jobTable.createdAt))
							.limit(input.limit)
							.all()
					);
				})
			)
		),

	cancel: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(({ ctx, input }) =>
			runEffect(
				ctx.runtime,
				Effect.gen(function* () {
					const db = yield* DbService;
					yield* Effect.promise(() =>
						db
							.update(jobTable)
							.set({ status: "cancelled" })
							.where(eq(jobTable.id, input.id))
					);
					return { success: true };
				})
			)
		),

	onProgress: publicProcedure
		.input(z.object({ jobId: z.string() }))
		.subscription(async function* (opts) {
			const { jobId } = opts.input;

			for await (const [event] of jobEvents.toIterable("progress", {
				signal: opts.signal,
			})) {
				if (event.jobId !== jobId) {
					continue;
				}
				yield event;
				if (
					event.status === "completed" ||
					event.status === "failed" ||
					event.status === "cancelled"
				) {
					return;
				}
			}
		}),
});
