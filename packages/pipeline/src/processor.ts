import { createHash } from "node:crypto";
import { stat, unlink } from "node:fs/promises";

import type { createDb } from "@indecks/db";
import { chunk as chunkTable } from "@indecks/db/schema/chunk";
import { library as libraryTable } from "@indecks/db/schema/library";
import { video as videoTable } from "@indecks/db/schema/video";
import type { VectorDb } from "@indecks/vector";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { EmbedConfig } from "./embedder";
import { embedVideo } from "./embedder";
import {
	chunkVideo,
	cleanupChunks,
	downscaleChunk,
	getVideoDuration,
	isStillFrame,
	scanDirectory,
} from "./ffmpeg";

type Db = ReturnType<typeof createDb>;

type ProgressCallback = (progress: number, message: string) => Promise<void>;

function makeChunkId(videoId: string, startTime: number): string {
	const raw = `${videoId}:${startTime}`;
	return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export async function scanLibraryFolder(
	db: Db,
	libraryId: string,
	onProgress?: ProgressCallback
): Promise<number> {
	const lib = await db
		.select()
		.from(libraryTable)
		.where(eq(libraryTable.id, libraryId))
		.get();

	if (!lib) {
		throw new Error(`Library ${libraryId} not found`);
	}

	await onProgress?.(0, "Scanning folder for videos...");

	const videoPaths = await scanDirectory(lib.folderPath);

	const existingVideos = await db
		.select({ filePath: videoTable.filePath })
		.from(videoTable)
		.where(eq(videoTable.libraryId, libraryId))
		.all();
	const existingPaths = new Set(existingVideos.map((v) => v.filePath));

	let added = 0;
	for (const filePath of videoPaths) {
		if (existingPaths.has(filePath)) {
			continue;
		}

		const fileName = filePath.split("/").pop() ?? filePath;
		const fileStat = await stat(filePath);
		const duration = await getVideoDuration(filePath).catch(() => null);

		await db.insert(videoTable).values({
			id: nanoid(),
			libraryId,
			filePath,
			fileName,
			fileSize: fileStat.size,
			duration,
			status: "pending",
		});

		added++;
		const pct = Math.round(
			(videoPaths.indexOf(filePath) / videoPaths.length) * 100
		);
		await onProgress?.(pct, `Found ${added} new videos...`);
	}

	await db
		.update(libraryTable)
		.set({
			videoCount: videoPaths.length,
			status: "idle",
		})
		.where(eq(libraryTable.id, libraryId));

	await onProgress?.(100, `Scan complete. ${added} new videos found.`);
	return added;
}

export async function processVideo(
	db: Db,
	vectorDb: VectorDb,
	videoId: string,
	embedConfig: EmbedConfig,
	onProgress?: ProgressCallback
): Promise<void> {
	const vid = await db
		.select()
		.from(videoTable)
		.where(eq(videoTable.id, videoId))
		.get();

	if (!vid) {
		throw new Error(`Video ${videoId} not found`);
	}

	await db
		.update(videoTable)
		.set({ status: "processing" })
		.where(eq(videoTable.id, videoId));

	try {
		await onProgress?.(0, `Chunking ${vid.fileName}...`);
		const chunks = await chunkVideo(vid.filePath);

		const totalChunks = chunks.length;
		let processed = 0;

		for (const chunkInfo of chunks) {
			const chunkId = makeChunkId(videoId, chunkInfo.startTime);

			const still = await isStillFrame(chunkInfo.chunkPath);

			await db
				.insert(chunkTable)
				.values({
					id: chunkId,
					videoId,
					startTime: chunkInfo.startTime,
					endTime: chunkInfo.endTime,
					isStillFrame: still,
					embeddingStatus: still ? "skipped" : "pending",
				})
				.onConflictDoNothing();

			if (still) {
				processed++;
				const pct = Math.round((processed / totalChunks) * 100);
				await onProgress?.(
					pct,
					`Chunk ${processed}/${totalChunks} (skipped - still frame)`
				);
				continue;
			}

			let downscaledPath: string | null = null;
			try {
				downscaledPath = await downscaleChunk(chunkInfo.chunkPath);
				const videoFile = Bun.file(downscaledPath);
				const videoBuffer = Buffer.from(await videoFile.arrayBuffer());

				const embedding = await embedVideo(videoBuffer, embedConfig);
				vectorDb.upsert(chunkId, new Float32Array(embedding));

				await db
					.update(chunkTable)
					.set({ embeddingStatus: "embedded" })
					.where(eq(chunkTable.id, chunkId));
			} catch (err) {
				await db
					.update(chunkTable)
					.set({ embeddingStatus: "error" })
					.where(eq(chunkTable.id, chunkId));
				throw err;
			} finally {
				if (downscaledPath) {
					await unlink(downscaledPath).catch(() => {
						/* cleanup */
					});
				}
			}

			processed++;
			const pct = Math.round((processed / totalChunks) * 100);
			await onProgress?.(pct, `Embedded chunk ${processed}/${totalChunks}`);
		}

		await cleanupChunks(chunks);

		await db
			.update(videoTable)
			.set({ status: "indexed" })
			.where(eq(videoTable.id, videoId));
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : String(err);
		await db
			.update(videoTable)
			.set({ status: "error", errorMessage })
			.where(eq(videoTable.id, videoId));
		throw err;
	}
}

export async function indexLibrary(
	db: Db,
	vectorDb: VectorDb,
	libraryId: string,
	embedConfig: EmbedConfig,
	onProgress?: ProgressCallback
): Promise<void> {
	await db
		.update(libraryTable)
		.set({ status: "scanning" })
		.where(eq(libraryTable.id, libraryId));

	await scanLibraryFolder(db, libraryId, onProgress);

	await db
		.update(libraryTable)
		.set({ status: "indexing" })
		.where(eq(libraryTable.id, libraryId));

	const videos = await db
		.select()
		.from(videoTable)
		.where(eq(videoTable.libraryId, libraryId))
		.all();

	const pendingVideos = videos.filter((v) => v.status === "pending");
	let processed = 0;

	for (const vid of pendingVideos) {
		await processVideo(db, vectorDb, vid.id, embedConfig, async (pct, msg) => {
			const overallPct = Math.round(
				((processed + pct / 100) / pendingVideos.length) * 100
			);
			await onProgress?.(
				overallPct,
				`Video ${processed + 1}/${pendingVideos.length}: ${msg}`
			);
		});
		processed++;
	}

	await db
		.update(libraryTable)
		.set({ status: "ready" })
		.where(eq(libraryTable.id, libraryId));

	await onProgress?.(100, "Indexing complete.");
}
