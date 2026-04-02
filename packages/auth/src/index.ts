import { DbService } from "@indecks/db";
import {
	account,
	accountRelations,
	session,
	sessionRelations,
	user,
	userRelations,
	verification,
} from "@indecks/db/schema/auth";
import { ServerConfig } from "@indecks/env/server";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { Context, Effect, Layer } from "effect";

export type Auth = ReturnType<typeof betterAuth>;

export class AuthService extends Context.Tag("AuthService")<
	AuthService,
	Auth
>() {}

export const AuthServiceLive = Layer.effect(
	AuthService,
	Effect.gen(function* () {
		const db = yield* DbService;
		const config = yield* ServerConfig;

		return betterAuth({
			database: drizzleAdapter(db, {
				provider: "sqlite",
				schema: {
					account,
					accountRelations,
					session,
					sessionRelations,
					user,
					userRelations,
					verification,
				},
			}),
			trustedOrigins: [config.CORS_ORIGIN],
			emailAndPassword: {
				enabled: true,
			},
			secret: config.BETTER_AUTH_SECRET,
			baseURL: config.BETTER_AUTH_URL,
			advanced: {
				defaultCookieAttributes: {
					sameSite: "none",
					secure: true,
					httpOnly: true,
				},
			},
			plugins: [],
		}) as Auth;
	})
);
