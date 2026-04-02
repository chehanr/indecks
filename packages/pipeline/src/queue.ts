import type { createDb } from "@indecks/db";
import { job as jobTable } from "@indecks/db/schema/job";
import { settings as settingsTable } from "@indecks/db/schema/settings";
import type { VectorDb } from "@indecks/vector";
import { and, eq } from "drizzle-orm";

import type { EmbedConfig } from "./embedder";
import { indexLibrary, processVideo, scanLibraryFolder } from "./processor";

type Db = ReturnType<typeof createDb>;

async function getEmbedConfig(db: Db): Promise<EmbedConfig | null> {
	const row = await db
		.select()
		.from(settingsTable)
		.where(eq(settingsTable.id, "default"))
		.get();

	if (!(row?.embeddingBaseUrl && row.embeddingModel)) {
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

	return {
		baseUrl: row.embeddingBaseUrl,
		apiKey: row.embeddingApiKey ?? "",
		model: row.embeddingModel,
		dimensions: row.embeddingDimensions,
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

async function processJob(
	db: Db,
	vectorDb: VectorDb,
	jobRow: typeof jobTable.$inferSelect
): Promise<void> {
	const onProgress = async (progress: number, message: string) => {
		await updateJobProgress(db, jobRow.id, progress, message);
	};

	const embedConfig = await getEmbedConfig(db);

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
			if (!embedConfig) {
				throw new Error("Embedding API not configured");
			}
			await processVideo(db, vectorDb, jobRow.videoId, embedConfig, onProgress);
			break;
		}
		case "index_library": {
			if (!jobRow.libraryId) {
				throw new Error("index_library job missing libraryId");
			}
			if (!embedConfig) {
				throw new Error("Embedding API not configured");
			}
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
	vectorDb: VectorDb,
	pollInterval = 3000
): { stop: () => void } {
	let running = true;

	const poll = async () => {
		while (running) {
			try {
				const jobRow = await claimNextJob(db);
				if (jobRow) {
					try {
						await processJob(db, vectorDb, jobRow);
						await completeJob(db, jobRow.id);
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						await failJob(db, jobRow.id, msg);
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
