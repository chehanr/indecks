import { resolve } from "node:path";

import { DbService } from "@indecks/db";
import { library as libraryTable } from "@indecks/db/schema/library";
import type { ManagedRuntime } from "effect";
import { Effect } from "effect";

let allowedPathsCache: string[] = [];
let allowedPathsCacheTime = 0;
const ALLOWED_PATHS_TTL = 30_000; // 30 seconds

export function createPathValidator(
	appRuntime: ManagedRuntime.ManagedRuntime<DbService, never>
) {
	async function getAllowedPaths(): Promise<string[]> {
		const now = Date.now();
		if (now - allowedPathsCacheTime < ALLOWED_PATHS_TTL) {
			return allowedPathsCache;
		}

		const libraries = await appRuntime.runPromise(
			Effect.gen(function* () {
				const db = yield* DbService;
				return yield* Effect.promise(() =>
					db.select().from(libraryTable).all()
				);
			})
		);

		allowedPathsCache = libraries.flatMap((lib) => {
			const folderPaths: string[] = JSON.parse(lib.folderPaths);
			return folderPaths.map((fp) => resolve(fp));
		});
		allowedPathsCacheTime = now;
		return allowedPathsCache;
	}

	return async function validateFilePath(
		filePath: string
	): Promise<{ absPath: string } | { error: string; status: 403 }> {
		const absPath = resolve(filePath);
		const allowed = await getAllowedPaths();

		if (!allowed.some((fp) => absPath.startsWith(fp))) {
			return { error: "Access denied", status: 403 };
		}

		return { absPath };
	};
}
