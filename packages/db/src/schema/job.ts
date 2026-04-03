import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const job = sqliteTable(
	"job",
	{
		id: text("id").primaryKey(),
		type: text("type", {
			enum: ["scan_library", "index_video", "index_library"],
		}).notNull(),
		status: text("status", {
			enum: ["pending", "running", "completed", "failed", "cancelled"],
		})
			.default("pending")
			.notNull(),
		libraryId: text("library_id"),
		videoId: text("video_id"),
		indexerId: text("indexer_id"),
		progress: integer("progress").default(0).notNull(),
		progressMessage: text("progress_message"),
		errorMessage: text("error_message"),
		startedAt: integer("started_at", { mode: "timestamp_ms" }),
		completedAt: integer("completed_at", { mode: "timestamp_ms" }),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
		updatedAt: integer("updated_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [
		index("job_status_idx").on(table.status),
		index("job_library_id_idx").on(table.libraryId),
		index("job_type_status_idx").on(table.type, table.status),
	]
);
