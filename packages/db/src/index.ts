import { ServerConfig } from "@indecks/env/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Context, Effect, Layer } from "effect";

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

const schema = {
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
};

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export class DbService extends Context.Tag("DbService")<DbService, Db>() {}

export const DbServiceLive = Layer.effect(
	DbService,
	Effect.map(ServerConfig, (config) => {
		const client = createClient({ url: config.DATABASE_URL });
		return drizzle({ client, schema });
	})
);
