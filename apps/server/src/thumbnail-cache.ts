import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

import { ThumbnailCacheService } from "@indecks/pipeline/thumbnail-cache";
import { Effect, Layer } from "effect";

const pathHash = (filePath: string) =>
	createHash("sha256").update(filePath).digest("hex").slice(0, 16);

export const ThumbnailCacheServiceLive = (dir: string) =>
	Layer.succeed(ThumbnailCacheService, {
		generateFromChunk: (videoPath, chunkPath, seconds) =>
			Effect.gen(function* () {
				const hash = pathHash(resolve(videoPath));
				const thumbPath = resolve(dir, `${hash}_${seconds}.jpg`);

				if (existsSync(thumbPath)) {
					return;
				}

				const result = yield* Effect.async<
					{ code: number | null; stderr: string },
					never
				>((resume) => {
					const stderrChunks: Buffer[] = [];
					const proc = spawn("ffmpeg", [
						"-nostdin",
						"-i",
						chunkPath,
						"-frames:v",
						"1",
						"-vf",
						"scale=320:-2",
						"-q:v",
						"6",
						"-y",
						thumbPath,
					]);
					proc.stdout.resume();
					proc.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
					proc.on("close", (code) =>
						resume(
							Effect.succeed({
								code,
								stderr: Buffer.concat(stderrChunks).toString(),
							})
						)
					);
				});

				if (result.code !== 0) {
					yield* Effect.logWarning(
						`Thumbnail failed (exit ${result.code}): ${thumbPath}\n${result.stderr.slice(-500)}`
					);
				}
			}).pipe(Effect.ignore),

		removeByPaths: (filePaths) =>
			Effect.gen(function* () {
				const prefixes = new Set(filePaths.map((p) => pathHash(resolve(p))));
				const files = readdirSync(dir);
				let removed = 0;
				for (const file of files) {
					const prefix = file.split("_")[0];
					if (prefix && prefixes.has(prefix)) {
						unlinkSync(resolve(dir, file));
						removed++;
					}
				}
				if (removed > 0) {
					yield* Effect.logInfo(
						`Removed ${removed} thumbnails for ${filePaths.length} video(s)`
					);
				}
			}).pipe(Effect.ignore),

		clear: () =>
			Effect.try(() => {
				for (const file of readdirSync(dir)) {
					if (file.endsWith(".webp") || file.endsWith(".jpg")) {
						unlinkSync(resolve(dir, file));
					}
				}
			}).pipe(Effect.ignore),
	});
