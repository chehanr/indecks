import { TRPCError } from "@trpc/server";
import { Effect, type Layer } from "effect";

import type { AppLayer, AppRuntime } from "./context";

type AppRequirements = Layer.Layer.Success<AppLayer>;

const mapError = (err: { readonly _tag: string }): TRPCError => {
	const record = err as Record<string, unknown>;
	switch (err._tag) {
		case "RecordNotFoundError":
			return new TRPCError({
				code: "NOT_FOUND",
				message: `${String(record.entity ?? "Record")} not found`,
			});
		case "FolderNotAccessibleError":
			return new TRPCError({
				code: "BAD_REQUEST",
				message: `Folder not accessible: ${String(record.path)}`,
			});
		case "LibraryNotFoundError":
			return new TRPCError({
				code: "NOT_FOUND",
				message: `Library not found: ${String(record.libraryId)}`,
			});
		case "VideoNotFoundError":
			return new TRPCError({
				code: "NOT_FOUND",
				message: `Video not found: ${String(record.videoId)}`,
			});
		case "LibraryEmbeddingNotConfiguredError":
			return new TRPCError({
				code: "BAD_REQUEST",
				message: "Library embedding not configured",
			});
		case "IndexerNotFoundError":
			return new TRPCError({
				code: "NOT_FOUND",
				message: `Indexer not found: ${String(record.indexerId)}`,
			});
		default:
			return new TRPCError({
				code: "INTERNAL_SERVER_ERROR",
				message: err._tag,
			});
	}
};

export const runEffect = <A, E extends { readonly _tag: string }>(
	runtime: AppRuntime,
	effect: Effect.Effect<A, E, AppRequirements>
): Promise<A> =>
	runtime.runPromise(
		effect.pipe(Effect.catchAll((err) => Effect.die(mapError(err))))
	);
