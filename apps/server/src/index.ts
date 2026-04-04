import { existsSync, mkdirSync, renameSync } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

import { trpcServer } from "@hono/trpc-server";
import { createTrpcContext, makeAppLayer } from "@indecks/api/context";
import { jobEvents } from "@indecks/api/events";
import { appRouter } from "@indecks/api/routers/index";
import { AuthService } from "@indecks/auth";
import { DbService } from "@indecks/db";
import { indexer as indexerTable } from "@indecks/db/schema/indexer";
import { library as libraryTable } from "@indecks/db/schema/library";
import { env } from "@indecks/env/server";
import {
	JobQueueService,
	setJobProgressCallback,
} from "@indecks/pipeline/queue";
import { VectorDbManagerService } from "@indecks/vector";
import { migrate } from "drizzle-orm/libsql/migrator";
import { Effect, Fiber, ManagedRuntime } from "effect";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const RANGE_PATTERN = /bytes=(\d+)-(\d*)/;

const vectorDbDir = resolve(env.VECTOR_DB_DIR);
mkdirSync(vectorDbDir, { recursive: true });

const appLayer = makeAppLayer(vectorDbDir);
const appRuntime = ManagedRuntime.make(appLayer);

// Run database migrations in production (Docker)
if (env.NODE_ENV === "production") {
	const migrationsFolder = resolve(import.meta.dir, "../../../migrations");
	await appRuntime.runPromise(
		Effect.gen(function* () {
			const db = yield* DbService;
			yield* Effect.promise(() => migrate(db, { migrationsFolder }));
			console.info("Database migrations applied");
		})
	);
}

// One-time migration: rename vector-${libraryId}.db → vector-${libraryId}-${indexerId}.db
await appRuntime.runPromise(
	Effect.gen(function* () {
		const db = yield* DbService;
		const indexers = yield* Effect.promise(() =>
			db.select().from(indexerTable).all()
		);
		for (const emb of indexers) {
			const oldPath = resolve(vectorDbDir, `vector-${emb.libraryId}.db`);
			const newPath = resolve(
				vectorDbDir,
				`vector-${emb.libraryId}-${emb.id}.db`
			);
			if (existsSync(oldPath) && !existsSync(newPath)) {
				renameSync(oldPath, newPath);
				for (const suffix of ["-wal", "-shm"]) {
					if (existsSync(`${oldPath}${suffix}`)) {
						renameSync(`${oldPath}${suffix}`, `${newPath}${suffix}`);
					}
				}
				console.info(
					`Migrated vector DB: ${emb.libraryId} → ${emb.libraryId}-${emb.id}`
				);
			}
		}
	})
);

setJobProgressCallback(
	(jobId, status, progress, progressMessage, errorMessage) => {
		jobEvents.emit("progress", {
			jobId,
			status,
			progress,
			progressMessage,
			errorMessage,
		});
	}
);

const workerFiber = await appRuntime.runPromise(
	Effect.gen(function* () {
		const jobQueue = yield* JobQueueService;
		const db = yield* DbService;
		const vectorDbManager = yield* VectorDbManagerService;

		const recovered = yield* jobQueue.recoverStaleJobs(db);
		if (recovered > 0) {
			console.info(`Recovered ${recovered} stale jobs`);
		}

		return yield* jobQueue.startWorker(db, vectorDbManager);
	})
);

const auth = await appRuntime.runPromise(AuthService);

const app = new Hono();

app.use(logger());
app.use(
	"/*",
	cors({
		origin: env.CORS_ORIGIN,
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization", "Range"],
		credentials: true,
		exposeHeaders: ["Content-Range", "Accept-Ranges", "Content-Length"],
	})
);

app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.use(
	"/trpc/*",
	trpcServer({
		router: appRouter,
		createContext: (_opts, context) => createTrpcContext(context, appRuntime),
	})
);

app.get("/api/video", async (c) => {
	const filePath = c.req.query("path");
	if (!filePath) {
		return c.text("Missing path parameter", 400);
	}

	const absPath = resolve(filePath);

	const libraries = await appRuntime.runPromise(
		Effect.gen(function* () {
			const db = yield* DbService;
			return yield* Effect.promise(() => db.select().from(libraryTable).all());
		})
	);

	const isAllowed = libraries.some((lib) => {
		const folderPaths: string[] = JSON.parse(lib.folderPaths);
		return folderPaths.some((fp) => absPath.startsWith(resolve(fp)));
	});
	if (!isAllowed) {
		return c.text("Access denied", 403);
	}

	const fileStat = await stat(absPath).catch(() => null);
	if (!fileStat) {
		return c.text("File not found", 404);
	}

	const fileSize = fileStat.size;
	const range = c.req.header("Range");

	if (range) {
		const match = range.match(RANGE_PATTERN);
		if (match) {
			const start = Number.parseInt(match[1] ?? "0", 10);
			const end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
			const chunkSize = end - start + 1;

			const file = Bun.file(absPath);
			const slice = file.slice(start, end + 1);

			return new Response(slice.stream(), {
				status: 206,
				headers: {
					"Content-Range": `bytes ${start}-${end}/${fileSize}`,
					"Accept-Ranges": "bytes",
					"Content-Length": String(chunkSize),
					"Content-Type": "video/mp4",
				},
			});
		}
	}

	const file = Bun.file(absPath);
	return new Response(file.stream(), {
		headers: {
			"Accept-Ranges": "bytes",
			"Content-Length": String(fileSize),
			"Content-Type": "video/mp4",
		},
	});
});

app.get("/healthz", (c) => c.text("OK"));

if (env.NODE_ENV === "production") {
	const { serveStatic } = await import("hono/bun");
	app.use("/assets/*", serveStatic({ root: "./public" }));
	app.get("*", serveStatic({ root: "./public", path: "index.html" }));
} else {
	app.get("/", (c) => c.text("OK"));
}

const shutdown = async () => {
	console.info("Shutting down...");
	await appRuntime
		.runPromise(Fiber.interrupt(workerFiber))
		.catch(() => undefined);
	await appRuntime.dispose().catch(() => undefined);
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default app;
