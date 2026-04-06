import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { Context, Layer } from "effect";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		VECTOR_DIR: z.string().default("./data/vector"),
		THUMBNAILS_DIR: z.string().default("./data/thumbnails"),
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		CORS_ORIGIN: z.url(),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});

export type ServerConfigShape = typeof env;

export class ServerConfig extends Context.Tag("ServerConfig")<
	ServerConfig,
	ServerConfigShape
>() {}

export const ServerConfigLive = Layer.sync(ServerConfig, () => env);
