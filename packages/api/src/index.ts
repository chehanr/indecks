import { initTRPC, TRPCError } from "@trpc/server";

import type { TrpcContext } from "./context";

export const t = initTRPC.context<TrpcContext>().create({
	sse: {
		maxDurationMs: 5 * 60 * 1000,
		ping: {
			enabled: true,
			intervalMs: 3000,
		},
		client: {
			reconnectAfterInactivityMs: 5000,
		},
	},
});

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
	if (!ctx.session) {
		throw new TRPCError({
			code: "UNAUTHORIZED",
			message: "Authentication required",
			cause: "No session",
		});
	}
	return next({
		ctx: {
			...ctx,
			session: ctx.session,
		},
	});
});
