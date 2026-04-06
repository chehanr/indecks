import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

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
import { Effect, Fiber, ManagedRuntime, Schedule } from "effect";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { ThumbnailCacheServiceLive } from "./thumbnail-cache";

const RANGE_PATTERN = /bytes=(\d+)-(\d*)/;

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

await appRuntime.runPromise(
	Effect.gen(function* () {
		const jobQueue = yield* JobQueueService;
		const db = yield* DbService;

		const recovered = yield* jobQueue.recoverStaleJobs(db);
		if (recovered > 0) {
			yield* Effect.logInfo(`Recovered ${recovered} stale jobs`);
		}
	})
);

const workerFiber = appRuntime.runFork(
	Effect.gen(function* () {
		yield* Effect.logInfo("Worker fiber started");
		const jobQueue = yield* JobQueueService;
		const db = yield* DbService;
		const vectorDbManager = yield* VectorDbManagerService;
		yield* jobQueue.startWorker(db, vectorDbManager);
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

// --- Shared path validation ---

async function validateFilePath(
	filePath: string
): Promise<{ absPath: string } | { error: string; status: 403 }> {
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
		return { error: "Access denied", status: 403 };
	}

	return { absPath };
}

// --- Thumbnail generation lock ---

const thumbLocks = new Map<string, Promise<number | null>>();

function generateThumbnail(
	absPath: string,
	thumbPath: string,
	seconds: number
): Promise<number | null> {
	const existing = thumbLocks.get(thumbPath);
	if (existing) {
		return existing;
	}

	const promise = new Promise<number | null>((res) => {
		const proc = spawn("ffmpeg", [
			"-ss",
			String(seconds),
			"-i",
			absPath,
			"-frames:v",
			"1",
			"-vf",
			"scale=320:-2",
			"-q:v",
			"6",
			"-y",
			thumbPath,
		]);
		proc.stderr.resume();
		proc.on("close", res);
	}).finally(() => {
		thumbLocks.delete(thumbPath);
	});

	thumbLocks.set(thumbPath, promise);
	return promise;
}

// --- Video endpoint ---

app.get("/api/video", async (c) => {
	const filePath = c.req.query("path");
	if (!filePath) {
		return c.text("Missing path parameter", 400);
	}

	const result = await validateFilePath(filePath);
	if ("error" in result) {
		return c.text(result.error, result.status);
	}

	const fileStat = await stat(result.absPath).catch(() => null);
	if (!fileStat) {
		return c.text("File not found", 404);
	}

	const fileSize = fileStat.size;
	const file = Bun.file(result.absPath);
	const contentType = file.type || "application/octet-stream";
	const fileName = basename(result.absPath);
	const etag = `"${fileStat.mtimeMs.toString(36)}-${fileSize.toString(36)}"`;
	const disposition = `inline; filename="${encodeURIComponent(fileName)}"`;

	if (c.req.header("If-None-Match") === etag) {
		return new Response(null, { status: 304 });
	}

	const MAX_CHUNK = 5 * 1024 * 1024; // 5 MB
	const range = c.req.header("Range");

	const rangeMatch = range?.match(RANGE_PATTERN);
	const start = rangeMatch ? Number.parseInt(rangeMatch[1] ?? "0", 10) : 0;
	const requested = rangeMatch?.[2]
		? Number.parseInt(rangeMatch[2], 10)
		: undefined;
	const end = Math.min(requested ?? start + MAX_CHUNK - 1, fileSize - 1);
	const chunkSize = end - start + 1;

	const slice = file.slice(start, end + 1);

	return new Response(slice.stream(), {
		status: 206,
		headers: {
			"Content-Range": `bytes ${start}-${end}/${fileSize}`,
			"Accept-Ranges": "bytes",
			"Content-Length": String(chunkSize),
			"Content-Type": contentType,
			"Content-Disposition": disposition,
			"Cache-Control": "public, max-age=86400",
			ETag: etag,
		},
	});
});

// --- Thumbnail endpoint ---

app.get("/api/thumbnail", async (c) => {
	const filePath = c.req.query("path");
	const time = c.req.query("time");
	if (!filePath || time === undefined) {
		return c.text("Missing path or time parameter", 400);
	}

	const seconds = Number.parseFloat(time);
	if (Number.isNaN(seconds) || seconds < 0) {
		return c.text("Invalid time parameter", 400);
	}

	const result = await validateFilePath(filePath);
	if ("error" in result) {
		return c.text(result.error, result.status);
	}

	const pathHash = createHash("sha256")
		.update(result.absPath)
		.digest("hex")
		.slice(0, 16);
	const thumbPath = resolve(thumbnailDir, `${pathHash}_${seconds}.jpg`);

	const thumbExists = await stat(thumbPath)
		.then(() => true)
		.catch(() => false);

	if (!thumbExists) {
		const exitCode = await generateThumbnail(
			result.absPath,
			thumbPath,
			seconds
		);
		if (exitCode !== 0) {
			return c.text("Thumbnail generation failed", 500);
		}
	}

	const file = Bun.file(thumbPath);
	return new Response(file.stream(), {
		headers: {
			"Content-Type": "image/jpeg",
			"Cache-Control": "public, max-age=604800, immutable",
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
	await appRuntime
		.runPromise(Fiber.interrupt(workerFiber))
		.catch(() => undefined);
	await appRuntime.dispose().catch(() => undefined);
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export default app;
