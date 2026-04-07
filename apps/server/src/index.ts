import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { trpcServer } from "@hono/trpc-server";
import { createTrpcContext, makeAppLayer } from "@indecks/api/context";
import { appRouter } from "@indecks/api/routers/index";
import { AuthService } from "@indecks/auth";
import { DbService } from "@indecks/db";
import { env } from "@indecks/env/server";
import { Effect, ManagedRuntime } from "effect";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { registerJobExecutor } from "./job-dispatch";
import { createMediaHandlers } from "./media";
import { runDatabaseMigrations } from "./migrations";
import { createPathValidator } from "./path-validation";
import { ThumbnailCacheServiceLive } from "./thumbnail-cache";
import {
	failStaleJobs,
	registerProgressCallback,
	startWorkerFiber,
} from "./worker";

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

if (env.NODE_ENV === "production") {
	await runDatabaseMigrations(appRuntime);
}

registerProgressCallback();
registerJobExecutor(appRuntime);
await failStaleJobs(appRuntime);

const worker = startWorkerFiber(appRuntime);
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

// --- Hono app ---

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

app.get("/livez", (c) => c.text("OK"));

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
	await worker.shutdown();
	await appRuntime.dispose().catch(() => undefined);
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

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
