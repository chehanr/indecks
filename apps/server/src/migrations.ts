import { resolve } from "node:path";

import { DbService } from "@indecks/db";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { ManagedRuntime } from "effect";
import { Effect } from "effect";

export const runDatabaseMigrations = (
	appRuntime: ManagedRuntime.ManagedRuntime<DbService, never>
) =>
	appRuntime.runPromise(
		Effect.gen(function* () {
			const migrationsFolder = resolve(import.meta.dir, "../../../migrations");
			const db = yield* DbService;
			yield* Effect.promise(() => migrate(db, { migrationsFolder }));
			yield* Effect.logInfo("Database migrations applied");
		})
	);
