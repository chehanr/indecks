import { publicProcedure, router } from "../index";
import { indexerRouter } from "./indexer";
import { jobRouter } from "./job";
import { libraryRouter } from "./library";
import { searchRouter } from "./search";

export const appRouter = router({
	healthCheck: publicProcedure.query(() => {
		return "OK";
	}),
	library: libraryRouter,
	indexer: indexerRouter,
	search: searchRouter,
	job: jobRouter,
});
export type AppRouter = typeof appRouter;
