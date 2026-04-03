import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { indexer } from "./indexer";
import { video } from "./video";

export const library = sqliteTable(
	"library",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		folderPath: text("folder_path").notNull(),
		status: text("status", {
			enum: ["idle", "scanning", "indexing", "ready", "error"],
		})
			.default("idle")
			.notNull(),
		videoCount: integer("video_count").default(0).notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [index("library_status_idx").on(table.status)]
);

export const libraryRelations = relations(library, ({ many }) => ({
	videos: many(video),
	indexers: many(indexer),
}));
