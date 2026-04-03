import { Database } from "bun:sqlite";
import { resolve } from "node:path";

import { FileSystem } from "@effect/platform";
import { Context, Effect, Layer, Ref } from "effect";
import { getLoadablePath } from "sqlite-vec";

import {
	SqliteLoadError,
	VectorDbDimensionMismatchError,
	VectorDbError,
} from "./errors";

const EXT_SUFFIX_RE = /\.(so|dylib|dll)$/;

const SQLITE_LIB_PATHS = [
	"/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
	"/usr/local/opt/sqlite3/lib/libsqlite3.dylib",
	"/usr/lib/x86_64-linux-gnu/libsqlite3.so",
	"/usr/lib/libsqlite3.so",
	"/usr/lib/libsqlite3.so.0",
];

const loadCustomSQLite = Effect.try({
	try: () => {
		for (const p of SQLITE_LIB_PATHS) {
			try {
				Database.setCustomSQLite(p);
				return;
			} catch {
				// try next path
			}
		}
		throw new Error("No system SQLite with extension support found");
	},
	catch: (e) =>
		new SqliteLoadError({
			message: e instanceof Error ? e.message : String(e),
		}),
});

export interface VectorSearchResult {
	chunkId: string;
	distance: number;
}

export interface VectorDb {
	readonly close: () => Effect.Effect<void>;
	readonly count: () => Effect.Effect<number, VectorDbError>;
	readonly getDimensions: () => number;
	readonly removeByChunkIds: (
		ids: string[]
	) => Effect.Effect<void, VectorDbError>;
	readonly search: (
		query: Float32Array,
		limit?: number
	) => Effect.Effect<VectorSearchResult[], VectorDbError>;
	readonly upsert: (
		chunkId: string,
		embedding: Float32Array
	) => Effect.Effect<void, VectorDbError>;
	readonly upsertBatch: (
		items: Array<{ chunkId: string; embedding: Float32Array }>
	) => Effect.Effect<void, VectorDbError>;
}

const makeVectorDb = (
	dbPath: string,
	dimensions: number
): Effect.Effect<VectorDb, VectorDbError> =>
	Effect.try({
		try: () => {
			const db = new Database(dbPath);
			const vecPath = getLoadablePath();
			db.loadExtension(vecPath.replace(EXT_SUFFIX_RE, ""));
			db.exec("PRAGMA journal_mode=WAL");
			db.exec(
				`CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(
					chunk_id TEXT PRIMARY KEY,
					embedding FLOAT[${dimensions}] distance_metric=cosine
				)`
			);

			const vdb: VectorDb = {
				upsert: (chunkId, embedding) =>
					Effect.try({
						try: () => {
							db.prepare(
								"INSERT OR REPLACE INTO vec_chunks(chunk_id, embedding) VALUES (?, vec_f32(?))"
							).run(chunkId, embedding);
						},
						catch: (e) =>
							new VectorDbError({
								message: `upsert failed: ${e}`,
								cause: e,
							}),
					}),

				upsertBatch: (items) =>
					Effect.try({
						try: () => {
							const stmt = db.prepare(
								"INSERT OR REPLACE INTO vec_chunks(chunk_id, embedding) VALUES (?, vec_f32(?))"
							);
							const tx = db.transaction(() => {
								for (const item of items) {
									stmt.run(item.chunkId, item.embedding);
								}
							});
							tx();
						},
						catch: (e) =>
							new VectorDbError({
								message: `upsertBatch failed: ${e}`,
								cause: e,
							}),
					}),

				search: (query, limit = 10) =>
					Effect.try({
						try: () => {
							const rows = db
								.prepare(
									`SELECT chunk_id, distance
									FROM vec_chunks
									WHERE embedding MATCH ?
									ORDER BY distance
									LIMIT ?`
								)
								.all(query, limit) as Array<{
								chunk_id: string;
								distance: number;
							}>;
							return rows.map((row) => ({
								chunkId: row.chunk_id,
								distance: row.distance,
							}));
						},
						catch: (e) =>
							new VectorDbError({
								message: `search failed: ${e}`,
								cause: e,
							}),
					}),

				removeByChunkIds: (ids) =>
					Effect.try({
						try: () => {
							if (ids.length === 0) {
								return;
							}
							const placeholders = ids.map(() => "?").join(",");
							db.prepare(
								`DELETE FROM vec_chunks WHERE chunk_id IN (${placeholders})`
							).run(...ids);
						},
						catch: (e) =>
							new VectorDbError({
								message: `removeByChunkIds failed: ${e}`,
								cause: e,
							}),
					}),

				count: () =>
					Effect.try({
						try: () => {
							const row = db
								.prepare("SELECT count(*) as cnt FROM vec_chunks")
								.get() as { cnt: number } | null;
							return row?.cnt ?? 0;
						},
						catch: (e) =>
							new VectorDbError({
								message: `count failed: ${e}`,
								cause: e,
							}),
					}),

				close: () =>
					Effect.sync(() => {
						db.close();
					}),

				getDimensions: () => dimensions,
			};

			return vdb;
		},
		catch: (e) =>
			new VectorDbError({
				message: `Failed to open vector DB: ${e}`,
				cause: e,
			}),
	});

export interface VectorDbManagerShape {
	readonly closeAll: () => Effect.Effect<void>;
	readonly get: (
		libraryId: string,
		indexerId: string,
		dimensions: number
	) => Effect.Effect<VectorDb, VectorDbError | VectorDbDimensionMismatchError>;
	readonly remove: (
		libraryId: string,
		indexerId?: string
	) => Effect.Effect<void, VectorDbError>;
}

export class VectorDbManagerService extends Context.Tag(
	"VectorDbManagerService"
)<VectorDbManagerService, VectorDbManagerShape>() {}

export const VectorDbManagerServiceLive = (dir: string) =>
	Layer.scoped(
		VectorDbManagerService,
		Effect.gen(function* () {
			yield* loadCustomSQLite;
			const fsService = yield* FileSystem.FileSystem;
			const cache = yield* Ref.make(new Map<string, VectorDb>());

			yield* Effect.addFinalizer(() =>
				Effect.gen(function* () {
					const map = yield* Ref.get(cache);
					for (const vdb of map.values()) {
						yield* vdb.close();
					}
				})
			);

			const cacheKey = (libraryId: string, indexerId: string) =>
				`${libraryId}:${indexerId}`;

			const dbFileName = (libraryId: string, indexerId: string) =>
				`vector-${libraryId}-${indexerId}.db`;

			const removeDbFiles = (dbPath: string) =>
				Effect.gen(function* () {
					yield* fsService.remove(dbPath).pipe(Effect.ignore);
					yield* fsService.remove(`${dbPath}-wal`).pipe(Effect.ignore);
					yield* fsService.remove(`${dbPath}-shm`).pipe(Effect.ignore);
				});

			const removeSingle = (libraryId: string, indexerId: string) =>
				Effect.gen(function* () {
					const map = yield* Ref.get(cache);
					const key = cacheKey(libraryId, indexerId);
					const existing = map.get(key);
					if (existing) {
						yield* existing.close();
						yield* Ref.update(cache, (m) => {
							const next = new Map(m);
							next.delete(key);
							return next;
						});
					}
					const dbPath = resolve(dir, dbFileName(libraryId, indexerId));
					yield* removeDbFiles(dbPath);
				});

			const removeAll = (libraryId: string) =>
				Effect.gen(function* () {
					const map = yield* Ref.get(cache);
					const prefix = `${libraryId}:`;
					for (const [key, vdb] of map) {
						if (key.startsWith(prefix)) {
							yield* vdb.close();
							yield* Ref.update(cache, (m) => {
								const next = new Map(m);
								next.delete(key);
								return next;
							});
						}
					}
					const filePrefix = `vector-${libraryId}-`;
					const files = yield* fsService
						.readDirectory(dir)
						.pipe(Effect.catchAll(() => Effect.succeed([] as string[])));
					for (const file of files) {
						if (
							file.startsWith(filePrefix) &&
							(file.endsWith(".db") ||
								file.endsWith(".db-wal") ||
								file.endsWith(".db-shm"))
						) {
							yield* fsService.remove(resolve(dir, file)).pipe(Effect.ignore);
						}
					}
				});

			return {
				get: (libraryId, indexerId, dimensions) =>
					Effect.gen(function* () {
						const key = cacheKey(libraryId, indexerId);
						const map = yield* Ref.get(cache);
						const existing = map.get(key);
						if (existing) {
							if (existing.getDimensions() !== dimensions) {
								return yield* new VectorDbDimensionMismatchError({
									libraryId,
									expected: existing.getDimensions(),
									actual: dimensions,
								});
							}
							return existing;
						}
						const dbPath = resolve(dir, dbFileName(libraryId, indexerId));
						const vdb = yield* makeVectorDb(dbPath, dimensions);
						yield* Ref.update(cache, (m) => new Map(m).set(key, vdb));
						return vdb;
					}),

				remove: (libraryId, indexerId) =>
					indexerId ? removeSingle(libraryId, indexerId) : removeAll(libraryId),

				closeAll: () =>
					Effect.gen(function* () {
						const map = yield* Ref.get(cache);
						for (const vdb of map.values()) {
							yield* vdb.close();
						}
						yield* Ref.set(cache, new Map());
					}),
			};
		})
	);
