import { relations, sql } from "drizzle-orm";
import {
	index,
	integer,
	real,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

import { chunk } from "./chunk";
import { library } from "./library";

export const video = sqliteTable(
	"video",
	{
		id: text("id").primaryKey(),
		libraryId: text("library_id")
			.notNull()
			.references(() => library.id, { onDelete: "cascade" }),
		filePath: text("file_path").notNull(),
		fileName: text("file_name").notNull(),
		fileSize: integer("file_size"),
		modifiedAt: integer("modified_at", { mode: "timestamp_ms" }),
		duration: real("duration"),
		status: text("status", {
			enum: ["pending", "processing", "indexed", "error"],
		})
			.default("pending")
			.notNull(),
		errorMessage: text("error_message"),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("video_library_id_idx").on(table.libraryId),
		index("video_status_idx").on(table.status),
	]
);

export const videoRelations = relations(video, ({ one, many }) => ({
	library: one(library, {
		fields: [video.libraryId],
		references: [library.id],
	}),
	chunks: many(chunk),
}));
