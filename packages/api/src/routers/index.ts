import { publicProcedure, router } from "../index";
import { jobRouter } from "./job";
import { libraryRouter } from "./library";
import { searchRouter } from "./search";
import { settingsRouter } from "./settings";

export const appRouter = router({
	healthCheck: publicProcedure.query(() => {
		return "OK";
	}),
	library: libraryRouter,
	search: searchRouter,
	job: jobRouter,
	settings: settingsRouter,
});
export type AppRouter = typeof appRouter;
