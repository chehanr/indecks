import { Context, type Effect } from "effect";

export interface ThumbnailCacheShape {
	readonly clear: () => Effect.Effect<void>;
	readonly removeByPaths: (filePaths: string[]) => Effect.Effect<void>;
}

export class ThumbnailCacheService extends Context.Tag("ThumbnailCacheService")<
	ThumbnailCacheService,
	ThumbnailCacheShape
>() {}
