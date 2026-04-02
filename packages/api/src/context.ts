import { auth } from "@indecks/auth";
import type { createDb } from "@indecks/db";
import type { VectorDb } from "@indecks/vector";
import type { Context as HonoContext } from "hono";

export interface CreateContextOptions {
	context: HonoContext;
	db: ReturnType<typeof createDb>;
	vectorDb: VectorDb;
}

export async function createContext({
	context,
	db,
	vectorDb,
}: CreateContextOptions) {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	return {
		db,
		vectorDb,
		session,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
