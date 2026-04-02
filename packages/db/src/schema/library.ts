import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
		embeddingInstruction: text("embedding_instruction"),
		embeddingBaseUrl: text("embedding_base_url"),
		embeddingApiKey: text("embedding_api_key"),
		embeddingModel: text("embedding_model"),
		embeddingDimensions: integer("embedding_dimensions"),
		chunkDuration: integer("chunk_duration").default(30).notNull(),
		chunkOverlap: integer("chunk_overlap").default(5).notNull(),
		downscaleFps: integer("downscale_fps").default(5).notNull(),
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
}));
