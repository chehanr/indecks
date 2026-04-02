import { auth } from "@indecks/auth";
import type { createDb } from "@indecks/db";
import type { VectorDbManager } from "@indecks/vector";
import type { Context as HonoContext } from "hono";

export interface CreateContextOptions {
	context: HonoContext;
	db: ReturnType<typeof createDb>;
	vectorDbManager: VectorDbManager;
}

export async function createContext({
	context,
	db,
	vectorDbManager,
}: CreateContextOptions) {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	return {
		db,
		vectorDbManager,
		session,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
