import { publicProcedure, router } from "../index";
import { embedderRouter } from "./embedder";
import { jobRouter } from "./job";
import { libraryRouter } from "./library";
import { searchRouter } from "./search";

export const appRouter = router({
	healthCheck: publicProcedure.query(() => {
		return "OK";
	}),
	library: libraryRouter,
	embedder: embedderRouter,
	search: searchRouter,
	job: jobRouter,
});
export type AppRouter = typeof appRouter;
