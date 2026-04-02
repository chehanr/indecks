import { Database } from "bun:sqlite";
import { getLoadablePath } from "sqlite-vec";

const SQLITE_LIB_PATHS = [
	"/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
	"/usr/local/opt/sqlite3/lib/libsqlite3.dylib",
	"/usr/lib/x86_64-linux-gnu/libsqlite3.so",
	"/usr/lib/libsqlite3.so",
];

function loadCustomSQLite(): void {
	for (const p of SQLITE_LIB_PATHS) {
		try {
			Database.setCustomSQLite(p);
			return;
		} catch {
			// try next path
		}
	}
	throw new Error(
		"Could not find a system SQLite with extension support. Install sqlite via brew or apt."
	);
}

interface VectorSearchResult {
	chunkId: string;
	distance: number;
}

loadCustomSQLite();

export class VectorDb {
	private readonly db: Database;
	private readonly dimensions: number;

	constructor(dbPath: string, dimensions = 768) {
		this.dimensions = dimensions;
		this.db = new Database(dbPath);
		this.db.loadExtension(getLoadablePath());
		this.db.exec("PRAGMA journal_mode=WAL");
		this.db.exec(
			`CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
				chunk_id TEXT PRIMARY KEY,
				embedding FLOAT[${dimensions}] distance_metric=cosine
			)`
		);
	}

	upsert(chunkId: string, embedding: Float32Array): void {
		this.db
			.prepare(
				"INSERT OR REPLACE INTO vec_chunks(chunk_id, embedding) VALUES (?, vec_f32(?))"
			)
			.run(chunkId, embedding);
	}

	upsertBatch(
		items: Array<{ chunkId: string; embedding: Float32Array }>
	): void {
		const stmt = this.db.prepare(
			"INSERT OR REPLACE INTO vec_chunks(chunk_id, embedding) VALUES (?, vec_f32(?))"
		);
		const tx = this.db.transaction(() => {
			for (const item of items) {
				stmt.run(item.chunkId, item.embedding);
			}
		});
		tx();
	}

	search(query: Float32Array, limit = 10): VectorSearchResult[] {
		const rows = this.db
			.prepare(
				`SELECT chunk_id, distance
				FROM vec_chunks
				WHERE embedding MATCH ?
				ORDER BY distance
				LIMIT ?`
			)
			.all(query, limit) as Array<{ chunk_id: string; distance: number }>;

		return rows.map((row) => ({
			chunkId: row.chunk_id,
			distance: row.distance,
		}));
	}

	removeByChunkIds(ids: string[]): void {
		if (ids.length === 0) {
			return;
		}
		const placeholders = ids.map(() => "?").join(",");
		this.db
			.prepare(`DELETE FROM vec_chunks WHERE chunk_id IN (${placeholders})`)
			.run(...ids);
	}

	count(): number {
		const row = this.db
			.prepare("SELECT count(*) as cnt FROM vec_chunks")
			.get() as { cnt: number } | null;
		return row?.cnt ?? 0;
	}

	close(): void {
		this.db.close();
	}

	getDimensions(): number {
		return this.dimensions;
	}
}
