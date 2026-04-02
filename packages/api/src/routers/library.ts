import { access } from "node:fs/promises";
import { chunk as chunkTable } from "@indecks/db/schema/chunk";
import { job as jobTable } from "@indecks/db/schema/job";
import { library as libraryTable } from "@indecks/db/schema/library";
import { video as videoTable } from "@indecks/db/schema/video";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { protectedProcedure, router } from "../index";

export const libraryRouter = router({
	list: protectedProcedure.query(({ ctx }) => {
		return ctx.db.select().from(libraryTable).all();
	}),

	get: protectedProcedure
		.input(z.object({ id: z.string() }))
		.query(async ({ ctx, input }) => {
			const lib = await ctx.db
				.select()
				.from(libraryTable)
				.where(eq(libraryTable.id, input.id))
				.get();
			if (!lib) {
				throw new Error("Library not found");
			}
			return lib;
		}),

	create: protectedProcedure
		.input(
			z.object({
				name: z.string().min(1),
				folderPath: z.string().min(1),
				embeddingInstruction: z.string().trim().optional(),
			})
		)
		.mutation(async ({ ctx, input }) => {
			await access(input.folderPath).catch(() => {
				throw new Error(`Folder not accessible: ${input.folderPath}`);
			});

			const id = nanoid();
			await ctx.db.insert(libraryTable).values({
				id,
				name: input.name,
				folderPath: input.folderPath,
				embeddingInstruction: input.embeddingInstruction || null,
			});

			return { id };
		}),

	update: protectedProcedure
		.input(
			z.object({
				id: z.string(),
				embeddingInstruction: z.string().trim().optional(),
			})
		)
		.mutation(async ({ ctx, input }) => {
			await ctx.db
				.update(libraryTable)
				.set({
					embeddingInstruction: input.embeddingInstruction || null,
				})
				.where(eq(libraryTable.id, input.id));

			return { success: true };
		}),

	delete: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const chunks = await ctx.db
				.select({ id: chunkTable.id })
				.from(chunkTable)
				.innerJoin(videoTable, eq(chunkTable.videoId, videoTable.id))
				.where(eq(videoTable.libraryId, input.id))
				.all();

			const chunkIds = chunks.map((c) => c.id);
			if (chunkIds.length > 0) {
				ctx.vectorDb.removeByChunkIds(chunkIds);
			}

			await ctx.db.delete(libraryTable).where(eq(libraryTable.id, input.id));

			return { success: true };
		}),

	startIndexing: protectedProcedure
		.input(z.object({ id: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const lib = await ctx.db
				.select()
				.from(libraryTable)
				.where(eq(libraryTable.id, input.id))
				.get();

			if (!lib) {
				throw new Error("Library not found");
			}

			const jobId = nanoid();
			await ctx.db.insert(jobTable).values({
				id: jobId,
				type: "index_library",
				libraryId: input.id,
				status: "pending",
			});

			return { jobId };
		}),

	reindexVideo: protectedProcedure
		.input(z.object({ videoId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const vid = await ctx.db
				.select()
				.from(videoTable)
				.where(eq(videoTable.id, input.videoId))
				.get();

			if (!vid) {
				throw new Error("Video not found");
			}

			const chunks = await ctx.db
				.select({ id: chunkTable.id })
				.from(chunkTable)
				.where(eq(chunkTable.videoId, input.videoId))
				.all();

			const chunkIds = chunks.map((c) => c.id);
			if (chunkIds.length > 0) {
				ctx.vectorDb.removeByChunkIds(chunkIds);
				await ctx.db
					.delete(chunkTable)
					.where(eq(chunkTable.videoId, input.videoId));
			}

			await ctx.db
				.update(videoTable)
				.set({ status: "pending", errorMessage: null })
				.where(eq(videoTable.id, input.videoId));

			const jobId = nanoid();
			await ctx.db.insert(jobTable).values({
				id: jobId,
				type: "index_video",
				videoId: input.videoId,
				libraryId: vid.libraryId,
				status: "pending",
			});

			return { jobId };
		}),

	videos: protectedProcedure
		.input(z.object({ libraryId: z.string() }))
		.query(({ ctx, input }) => {
			return ctx.db
				.select()
				.from(videoTable)
				.where(eq(videoTable.libraryId, input.libraryId))
				.all();
		}),
});
