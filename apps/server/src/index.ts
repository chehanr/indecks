import { existsSync, mkdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";

import { trpcServer } from "@hono/trpc-server";
import { createTrpcContext, makeAppLayer } from "@indecks/api/context";
import { jobEvents } from "@indecks/api/events";
import { appRouter } from "@indecks/api/routers/index";
import { AuthService } from "@indecks/auth";
import { DbService } from "@indecks/db";
import { indexer as indexerTable } from "@indecks/db/schema/indexer";
import { env } from "@indecks/env/server";
import { ProcessorService } from "@indecks/pipeline/processor";
import {
	JobQueueService,
	setJobProgressCallback,
} from "@indecks/pipeline/queue";
import { setJobExecutor } from "@indecks/state/bridge";
import { VectorDbManagerService } from "@indecks/vector";
import { migrate } from "drizzle-orm/libsql/migrator";
import { Effect, Fiber, ManagedRuntime, Schedule } from "effect";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createMediaHandlers } from "./media";
import { createPathValidator } from "./path-validation";
import { ThumbnailCacheServiceLive } from "./thumbnail-cache";

const vectorDir = resolve(env.VECTOR_DIR);
const thumbnailDir = resolve(env.THUMBNAILS_DIR);

for (const dir of [vectorDir, thumbnailDir]) {
	mkdirSync(dir, { recursive: true });
}

const appLayer = makeAppLayer(
	vectorDir,
	ThumbnailCacheServiceLive(thumbnailDir)
);
const appRuntime = ManagedRuntime.make(appLayer);

// Run database migrations in production (Docker)
if (env.NODE_ENV === "production") {
	const migrationsFolder = resolve(import.meta.dir, "../../../migrations");
	await appRuntime.runPromise(
		Effect.gen(function* () {
			const db = yield* DbService;
			yield* Effect.promise(() => migrate(db, { migrationsFolder }));
			yield* Effect.logInfo("Database migrations applied");
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
			const oldPath = resolve(vectorDir, `vector-${emb.libraryId}.db`);
			const newPath = resolve(
				vectorDir,
				`vector-${emb.libraryId}-${emb.id}.db`
			);
			if (existsSync(oldPath) && !existsSync(newPath)) {
				renameSync(oldPath, newPath);
				for (const suffix of ["-wal", "-shm"]) {
					if (existsSync(`${oldPath}${suffix}`)) {
						renameSync(`${oldPath}${suffix}`, `${newPath}${suffix}`);
					}
				}
				yield* Effect.logInfo(
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

setJobExecutor(async (input, callbacks) => {
	await appRuntime.runPromise(
		Effect.gen(function* () {
			const processor = yield* ProcessorService;
			const db = yield* DbService;
			const vectorDbManager = yield* VectorDbManagerService;

			const onProgress = (progress: number, message: string) =>
				Effect.sync(() => callbacks.onProgress(progress, message));

			switch (input.jobType) {
				case "scan_library": {
					if (!input.libraryId) {
						throw new Error("scan_library requires libraryId");
					}
					yield* processor.scanLibraryFolder(db, input.libraryId, onProgress);
					break;
				}
				case "index_video": {
					if (!(input.videoId && input.indexerId)) {
						throw new Error("index_video requires videoId and indexerId");
					}
					yield* processor.processVideo(
						db,
						input.videoId,
						input.indexerId,
						vectorDbManager,
						input.jobId,
						onProgress
					);
					break;
				}
				case "index_library": {
					if (!(input.libraryId && input.indexerId)) {
						throw new Error("index_library requires libraryId and indexerId");
					}
					yield* processor.indexLibrary(
						db,
						vectorDbManager,
						input.libraryId,
						input.indexerId,
						input.jobId,
						onProgress
					);
					break;
				}
				default:
					throw new Error(`Unknown job type: ${input.jobType}`);
			}
		})
	);
});

await appRuntime.runPromise(
	Effect.gen(function* () {
		const jobQueue = yield* JobQueueService;
		const db = yield* DbService;

		const failed = yield* jobQueue.failStaleJobs(db);
		if (failed > 0) {
			yield* Effect.logInfo(`Marked ${failed} stale jobs as failed`);
		}
	})
);

const workerFiber = appRuntime.runFork(
	Effect.gen(function* () {
		yield* Effect.logInfo("Worker fiber started");
		const jobQueue = yield* JobQueueService;
		const db = yield* DbService;
		yield* jobQueue.startWorker(db);
		yield* Effect.logWarning("Worker fiber exited unexpectedly");
	}).pipe(
		Effect.catchAllCause((cause) =>
			Effect.logError("Worker fiber crashed, restarting...").pipe(
				Effect.annotateLogs("cause", cause.toString()),
				Effect.flatMap(() => Effect.fail("worker-crashed" as const))
			)
		),
		Effect.retry(
			Schedule.exponential("1 second").pipe(
				Schedule.union(Schedule.spaced("30 seconds"))
			)
		),
		Effect.annotateLogs("component", "worker")
	)
);

const auth = await appRuntime.runPromise(AuthService);
const validateFilePath = createPathValidator(appRuntime);

const corsHeaders: Record<string, string> = {
	"Access-Control-Allow-Origin": env.CORS_ORIGIN,
	"Access-Control-Allow-Credentials": "true",
	"Access-Control-Expose-Headers":
		"Content-Range, Accept-Ranges, Content-Length",
};

const media = createMediaHandlers({
	auth,
	corsHeaders,
	thumbnailDir,
	validateFilePath,
});

// --- Hono app (tRPC, auth, static files) ---

const app = new Hono();

app.use(
	logger((msg) => {
		appRuntime.runSync(
			Effect.logInfo(msg).pipe(Effect.annotateLogs("component", "http"))
		);
	})
);
app.use(
	"/*",
	cors({
		origin: env.CORS_ORIGIN,
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization", "Range"],
		credentials: true,
		exposeHeaders: ["Content-Range", "Accept-Ranges", "Content-Length"],
		maxAge: 86_400,
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

// Liveness: is the process alive and not deadlocked?
app.get("/livez", (c) => c.text("OK"));

// Readiness: can the server handle requests? (checks DB connection)
app.get("/readyz", async (c) => {
	try {
		await appRuntime.runPromise(
			Effect.gen(function* () {
				const db = yield* DbService;
				yield* Effect.promise(() => db.run("SELECT 1"));
			})
		);
		return c.text("OK");
	} catch {
		return c.text("Service Unavailable", 503);
	}
});

if (env.NODE_ENV === "production") {
	const { serveStatic } = await import("hono/bun");
	app.use("/assets/*", serveStatic({ root: "./public" }));
	app.get("*", serveStatic({ root: "./public", path: "index.html" }));
} else {
	app.get("/", (c) => c.text("OK"));
}

const shutdown = async () => {
	await appRuntime
		.runPromise(Fiber.interrupt(workerFiber))
		.catch(() => undefined);
	await appRuntime.dispose().catch(() => undefined);
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Media endpoints bypass Hono for native Bun file serving
export default {
	fetch(req: Request) {
		const url = new URL(req.url);
		if (url.pathname === "/api/video" || url.pathname === "/api/thumbnail") {
			if (req.method === "OPTIONS") {
				return media.handlePreflight();
			}
			if (url.pathname === "/api/video") {
				return media.handleVideo(req);
			}
			return media.handleThumbnail(req);
		}
		return app.fetch(req);
	},
	port: 3000,
	idleTimeout: 120,
};
