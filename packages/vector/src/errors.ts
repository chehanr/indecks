import { Data } from "effect";

export class VectorDbError extends Data.TaggedError("VectorDbError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class VectorDbDimensionMismatchError extends Data.TaggedError(
	"VectorDbDimensionMismatchError"
)<{
	readonly libraryId: string;
	readonly expected: number;
	readonly actual: number;
}> {}

export class SqliteLoadError extends Data.TaggedError("SqliteLoadError")<{
	readonly message: string;
}> {}
