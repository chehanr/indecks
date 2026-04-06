import { createHash } from "node:crypto";
import { readdirSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

import { ThumbnailCacheService } from "@indecks/pipeline/thumbnail-cache";
import { Effect, Layer } from "effect";

const pathHash = (filePath: string) =>
	createHash("sha256").update(filePath).digest("hex").slice(0, 16);

export const ThumbnailCacheServiceLive = (dir: string) =>
	Layer.succeed(ThumbnailCacheService, {
		removeByPaths: (filePaths) =>
			Effect.try(() => {
				const prefixes = new Set(filePaths.map((p) => pathHash(resolve(p))));
				for (const file of readdirSync(dir)) {
					const prefix = file.split("_")[0];
					if (prefix && prefixes.has(prefix)) {
						unlinkSync(resolve(dir, file));
					}
				}
			}).pipe(Effect.ignore),

		clear: () =>
			Effect.try(() => {
				for (const file of readdirSync(dir)) {
					if (file.endsWith(".jpg")) {
						unlinkSync(resolve(dir, file));
					}
				}
			}).pipe(Effect.ignore),
	});
