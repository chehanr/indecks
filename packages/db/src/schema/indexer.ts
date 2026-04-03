import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { chunk } from "./chunk";
import { library } from "./library";

export const indexer = sqliteTable(
	"indexer",
	{
		id: text("id").primaryKey(),
		libraryId: text("library_id")
			.notNull()
			.references(() => library.id, { onDelete: "cascade" }),
		name: text("name").notNull(),
		baseUrl: text("base_url").notNull(),
		apiKey: text("api_key"),
		model: text("model").notNull(),
		dimensions: integer("dimensions").notNull(),
		instruction: text("instruction"),
		isDefault: integer("is_default", { mode: "boolean" })
			.default(false)
			.notNull(),
		chunkDuration: integer("chunk_duration").default(30).notNull(),
		chunkOverlap: integer("chunk_overlap").default(5).notNull(),
		downscaleFps: integer("downscale_fps").default(5).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("indexer_library_id_idx").on(table.libraryId)]
);

export const indexerRelations = relations(indexer, ({ one, many }) => ({
	library: one(library, {
		fields: [indexer.libraryId],
		references: [library.id],
	}),
	chunks: many(chunk),
}));
