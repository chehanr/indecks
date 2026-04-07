import { Data } from "effect";

export class InvalidTransitionError extends Data.TaggedError(
	"InvalidTransitionError"
)<{
	readonly currentState: string;
	readonly event: string;
	readonly machine: string;
}> {}
