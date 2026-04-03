import { Data } from "effect";

export class EmbeddingApiError extends Data.TaggedError("EmbeddingApiError")<{
	readonly statusCode: number;
	readonly body: string;
}> {}

export class EmbeddingEmptyResponseError extends Data.TaggedError(
	"EmbeddingEmptyResponseError"
	// biome-ignore lint/complexity/noBannedTypes: no additional fields for this tagged error
)<{}> {}

export class EmbeddingDimensionMismatchError extends Data.TaggedError(
	"EmbeddingDimensionMismatchError"
)<{
	readonly expected: number;
	readonly actual: number;
}> {}

export class FFmpegError extends Data.TaggedError("FFmpegError")<{
	readonly command: string;
	readonly exitCode: number;
	readonly stderr: string;
}> {}

export class VideoNotFoundError extends Data.TaggedError("VideoNotFoundError")<{
	readonly videoId: string;
}> {}

export class LibraryNotFoundError extends Data.TaggedError(
	"LibraryNotFoundError"
)<{
	readonly libraryId: string;
}> {}

export class LibraryEmbeddingNotConfiguredError extends Data.TaggedError(
	"LibraryEmbeddingNotConfiguredError"
)<{
	readonly libraryId: string;
}> {}

export class FolderNotAccessibleError extends Data.TaggedError(
	"FolderNotAccessibleError"
)<{
	readonly path: string;
}> {}

export class JobMissingFieldError extends Data.TaggedError(
	"JobMissingFieldError"
)<{
	readonly jobType: string;
	readonly field: string;
}> {}

export class UnknownJobTypeError extends Data.TaggedError(
	"UnknownJobTypeError"
)<{
	readonly jobType: string;
}> {}

export class EmbedderNotFoundError extends Data.TaggedError(
	"EmbedderNotFoundError"
)<{
	readonly embedderId: string;
}> {}
