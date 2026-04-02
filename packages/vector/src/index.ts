import { Database } from "bun:sqlite";

interface VectorSearchResult {
	chunkId: string;
	distance: number;
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	let dot = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < a.length; i++) {
		const ai = a[i] ?? 0;
		const bi = b[i] ?? 0;
		dot += ai * bi;
		normA += ai * ai;
		normB += bi * bi;
	}
	const denom = Math.sqrt(normA) * Math.sqrt(normB);
	if (denom === 0) {
		return 0;
	}
	return dot / denom;
}

export class VectorDb {
	private readonly db: Database;
	private readonly dimensions: number;

	constructor(dbPath: string, dimensions = 768) {
		this.dimensions = dimensions;
		this.db = new Database(dbPath);
		this.db.exec("PRAGMA journal_mode=WAL");
		this.db.exec(
			`CREATE TABLE IF NOT EXISTS vec_chunks (
				chunk_id TEXT PRIMARY KEY,
				embedding BLOB NOT NULL
			)`
		);
	}

	upsert(chunkId: string, embedding: Float32Array): void {
		const stmt = this.db.prepare(
			"INSERT OR REPLACE INTO vec_chunks(chunk_id, embedding) VALUES ($chunkId, $embedding)"
		);
		stmt.run({
			$chunkId: chunkId,
			$embedding: new Uint8Array(embedding.buffer),
		});
	}

	upsertBatch(
		items: Array<{ chunkId: string; embedding: Float32Array }>
	): void {
		const stmt = this.db.prepare(
			"INSERT OR REPLACE INTO vec_chunks(chunk_id, embedding) VALUES ($chunkId, $embedding)"
		);
		const tx = this.db.transaction(() => {
			for (const item of items) {
				stmt.run({
					$chunkId: item.chunkId,
					$embedding: new Uint8Array(item.embedding.buffer),
				});
			}
		});
		tx();
	}

	search(query: Float32Array, limit = 10): VectorSearchResult[] {
		const rows = this.db
			.prepare("SELECT chunk_id, embedding FROM vec_chunks")
			.all() as Array<{ chunk_id: string; embedding: Uint8Array }>;

		const scored = rows.map((row) => {
			const stored = new Float32Array(
				row.embedding.buffer,
				row.embedding.byteOffset,
				row.embedding.byteLength / 4
			);
			const similarity = cosineSimilarity(query, stored);
			return { chunkId: row.chunk_id, distance: 1 - similarity };
		});

		scored.sort((a, b) => a.distance - b.distance);
		return scored.slice(0, limit);
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
