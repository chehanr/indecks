import { env } from "@indecks/env/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import {
	account,
	accountRelations,
	session,
	sessionRelations,
	user,
	userRelations,
	verification,
} from "./schema/auth";
import { chunk, chunkRelations } from "./schema/chunk";
import { job } from "./schema/job";
import { library, libraryRelations } from "./schema/library";
import { video, videoRelations } from "./schema/video";

export function createDb() {
	const client = createClient({
		url: env.DATABASE_URL,
	});

	return drizzle({
		client,
		schema: {
			account,
			accountRelations,
			session,
			sessionRelations,
			user,
			userRelations,
			verification,
			library,
			libraryRelations,
			video,
			videoRelations,
			chunk,
			chunkRelations,
			job,
		},
	});
}

export const db = createDb();
