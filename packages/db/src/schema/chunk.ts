import { relations, sql } from "drizzle-orm";
import {
	index,
	integer,
	real,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

import { video } from "./video";

export const chunk = sqliteTable(
	"chunk",
	{
		id: text("id").primaryKey(),
		videoId: text("video_id")
			.notNull()
			.references(() => video.id, { onDelete: "cascade" }),
		startTime: real("start_time").notNull(),
		endTime: real("end_time").notNull(),
		isStillFrame: integer("is_still_frame", { mode: "boolean" })
			.default(false)
			.notNull(),
		embeddingStatus: text("embedding_status", {
			enum: ["pending", "embedded", "skipped", "error"],
		})
			.default("pending")
			.notNull(),
		createdAt: integer("created_at", { mode: "timestamp_ms" })
			.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
			.notNull(),
	},
	(table) => [
		index("chunk_video_id_idx").on(table.videoId),
		index("chunk_embedding_status_idx").on(table.embeddingStatus),
	]
);

export const chunkRelations = relations(chunk, ({ one }) => ({
	video: one(video, {
		fields: [chunk.videoId],
		references: [video.id],
	}),
}));
