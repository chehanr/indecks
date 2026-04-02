import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
	id: text("id").primaryKey(),
	embeddingBaseUrl: text("embedding_base_url"),
	embeddingApiKey: text("embedding_api_key"),
	embeddingModel: text("embedding_model"),
	embeddingDimensions: integer("embedding_dimensions").default(768).notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp_ms" })
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.$onUpdate(() => new Date())
		.notNull(),
});
