import { router } from "../index";
import { indexerRouter } from "./indexer";
import { jobRouter } from "./job";
import { libraryRouter } from "./library";
import { searchRouter } from "./search";

export const appRouter = router({
	library: libraryRouter,
	indexer: indexerRouter,
	search: searchRouter,
	job: jobRouter,
});
export type AppRouter = typeof appRouter;
