import type { createDb } from "@indecks/db";
import { job as jobTable } from "@indecks/db/schema/job";
import { library as libraryTable } from "@indecks/db/schema/library";
import { video as videoTable } from "@indecks/db/schema/video";
import type { VectorDbManager } from "@indecks/vector";
import { and, eq } from "drizzle-orm";

import type { EmbedConfig } from "./embedder";
import { indexLibrary, processVideo, scanLibraryFolder } from "./processor";

type Db = ReturnType<typeof createDb>;

async function getLibraryEmbedConfig(
	db: Db,
	libraryId: string
): Promise<EmbedConfig | null> {
	const lib = await db
		.select({
			embeddingBaseUrl: libraryTable.embeddingBaseUrl,
			embeddingApiKey: libraryTable.embeddingApiKey,
			embeddingModel: libraryTable.embeddingModel,
			embeddingDimensions: libraryTable.embeddingDimensions,
		})
		.from(libraryTable)
		.where(eq(libraryTable.id, libraryId))
		.get();

	if (
		!(lib?.embeddingBaseUrl && lib.embeddingModel && lib.embeddingDimensions)
	) {
		return null;
	}

	return {
		baseUrl: lib.embeddingBaseUrl,
		apiKey: lib.embeddingApiKey ?? "",
		model: lib.embeddingModel,
		dimensions: lib.embeddingDimensions,
	};
}

async function claimNextJob(db: Db) {
	const pending = await db
		.select()
		.from(jobTable)
		.where(eq(jobTable.status, "pending"))
		.orderBy(jobTable.createdAt)
		.limit(1)
		.get();

	if (!pending) {
		return null;
	}

	await db
		.update(jobTable)
		.set({
			status: "running",
			startedAt: new Date(),
		})
		.where(and(eq(jobTable.id, pending.id), eq(jobTable.status, "pending")));

	const claimed = await db
		.select()
		.from(jobTable)
		.where(and(eq(jobTable.id, pending.id), eq(jobTable.status, "running")))
		.get();

	return claimed ?? null;
}

async function updateJobProgress(
	db: Db,
	jobId: string,
	progress: number,
	message: string
): Promise<void> {
	await db
		.update(jobTable)
		.set({
			progress,
			progressMessage: message,
		})
		.where(eq(jobTable.id, jobId));
}

async function completeJob(db: Db, jobId: string): Promise<void> {
	await db
		.update(jobTable)
		.set({
			status: "completed",
			progress: 100,
			completedAt: new Date(),
		})
		.where(eq(jobTable.id, jobId));
}

async function failJob(db: Db, jobId: string, error: string): Promise<void> {
	await db
		.update(jobTable)
		.set({
			status: "failed",
			errorMessage: error,
			completedAt: new Date(),
		})
		.where(eq(jobTable.id, jobId));
}

async function resolveLibraryId(
	db: Db,
	jobRow: typeof jobTable.$inferSelect
): Promise<string | null> {
	if (jobRow.libraryId) {
		return jobRow.libraryId;
	}
	if (jobRow.videoId) {
		const vid = await db
			.select({ libraryId: videoTable.libraryId })
			.from(videoTable)
			.where(eq(videoTable.id, jobRow.videoId))
			.get();
		return vid?.libraryId ?? null;
	}
	return null;
}

async function processJob(
	db: Db,
	vectorDbManager: VectorDbManager,
	jobRow: typeof jobTable.$inferSelect
): Promise<void> {
	const onProgress = async (progress: number, message: string) => {
		await updateJobProgress(db, jobRow.id, progress, message);
	};

	switch (jobRow.type) {
		case "scan_library": {
			if (!jobRow.libraryId) {
				throw new Error("scan_library job missing libraryId");
			}
			await scanLibraryFolder(db, jobRow.libraryId, onProgress);
			break;
		}
		case "index_video": {
			if (!jobRow.videoId) {
				throw new Error("index_video job missing videoId");
			}
			const libraryId = await resolveLibraryId(db, jobRow);
			if (!libraryId) {
				throw new Error("Could not resolve libraryId for index_video job");
			}
			const embedConfig = await getLibraryEmbedConfig(db, libraryId);
			if (!embedConfig) {
				throw new Error("Library embedding not configured");
			}
			const vectorDb = vectorDbManager.get(libraryId, embedConfig.dimensions);
			const lib = await db
				.select({ embeddingInstruction: libraryTable.embeddingInstruction })
				.from(libraryTable)
				.where(eq(libraryTable.id, libraryId))
				.get();
			await processVideo(
				db,
				vectorDb,
				jobRow.videoId,
				embedConfig,
				onProgress,
				lib?.embeddingInstruction ?? undefined
			);
			break;
		}
		case "index_library": {
			if (!jobRow.libraryId) {
				throw new Error("index_library job missing libraryId");
			}
			const embedConfig = await getLibraryEmbedConfig(db, jobRow.libraryId);
			if (!embedConfig) {
				throw new Error("Library embedding not configured");
			}
			const vectorDb = vectorDbManager.get(
				jobRow.libraryId,
				embedConfig.dimensions
			);
			await indexLibrary(
				db,
				vectorDb,
				jobRow.libraryId,
				embedConfig,
				onProgress
			);
			break;
		}
		default:
			throw new Error(`Unknown job type: ${jobRow.type}`);
	}
}

export async function recoverStaleJobs(db: Db): Promise<number> {
	const result = await db
		.update(jobTable)
		.set({
			status: "pending",
			progressMessage: "Recovered after server restart",
		})
		.where(eq(jobTable.status, "running"));

	return result.rowsAffected;
}

export function startWorker(
	db: Db,
	vectorDbManager: VectorDbManager,
	pollInterval = 3000
): { stop: () => void } {
	let running = true;

	const poll = async () => {
		while (running) {
			try {
				const jobRow = await claimNextJob(db);
				if (jobRow) {
					try {
						await processJob(db, vectorDbManager, jobRow);
						await completeJob(db, jobRow.id);
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						await failJob(db, jobRow.id, msg);
						if (jobRow.libraryId) {
							await db
								.update(libraryTable)
								.set({ status: "error" })
								.where(eq(libraryTable.id, jobRow.libraryId));
						}
					}
				}
			} catch {
				// ignore polling errors
			}
			await new Promise((resolve) => setTimeout(resolve, pollInterval));
		}
	};

	poll();

	return {
		stop() {
			running = false;
		},
	};
}
