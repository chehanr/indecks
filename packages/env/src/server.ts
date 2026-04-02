import "dotenv/config";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		DATABASE_URL: z.string().min(1),
		VECTOR_DB_PATH: z.string().default("vector.db"),
		BETTER_AUTH_SECRET: z.string().min(32),
		BETTER_AUTH_URL: z.url(),
		CORS_ORIGIN: z.url(),
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
		EMBEDDING_API_BASE_URL: z.string().optional(),
		EMBEDDING_API_KEY: z.string().optional(),
		EMBEDDING_MODEL: z.string().optional(),
		EMBEDDING_DIMENSIONS: z.coerce.number().default(768),
	},
	runtimeEnv: process.env,
	emptyStringAsUndefined: true,
});
