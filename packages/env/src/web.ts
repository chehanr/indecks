import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const isProduction = process.env.NODE_ENV === "production";

export const env = createEnv({
	clientPrefix: "VITE_",
	client: {
		VITE_SERVER_URL: isProduction ? z.string().default("") : z.string().url(),
	},
	runtimeEnv: (
		import.meta as unknown as { env: Record<string, string | undefined> }
	).env,
	emptyStringAsUndefined: true,
});
