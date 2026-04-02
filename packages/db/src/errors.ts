import { Data } from "effect";

export class DatabaseError extends Data.TaggedError("DatabaseError")<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

export class RecordNotFoundError extends Data.TaggedError(
	"RecordNotFoundError"
)<{
	readonly entity: string;
	readonly id: string;
}> {}
