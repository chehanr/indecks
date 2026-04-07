import { FetchHttpClient } from "@effect/platform";
import { BunCommandExecutor, BunFileSystem } from "@effect/platform-bun";
import { AuthService, AuthServiceLive } from "@indecks/auth";
import { DbServiceLive } from "@indecks/db";
import { ServerConfigLive } from "@indecks/env/server";
import { EmbedServiceLive } from "@indecks/pipeline/embedder";
import { FFmpegServiceLive } from "@indecks/pipeline/ffmpeg";
import { ProcessorServiceLive } from "@indecks/pipeline/processor";
import { JobQueueServiceLive } from "@indecks/pipeline/queue";
import type { ThumbnailCacheService } from "@indecks/pipeline/thumbnail-cache";
import { ActorManagerServiceLive } from "@indecks/state/effect-bridge";
import { VectorDbManagerServiceLive } from "@indecks/vector";
import { Effect, Layer, type ManagedRuntime } from "effect";
import type { Context as HonoContext } from "hono";

export const makeAppLayer = (
	vectorDbDir: string,
	thumbCacheLayer: Layer.Layer<ThumbnailCacheService>
) => {
	const ConfigLayer = ServerConfigLive;
	const FsLayer = BunFileSystem.layer;
	const CmdLayer = BunCommandExecutor.layer.pipe(Layer.provide(FsLayer));
	const HttpLayer = FetchHttpClient.layer;
	const PlatformLayer = Layer.mergeAll(FsLayer, CmdLayer, HttpLayer);
	const DbLayer = DbServiceLive.pipe(Layer.provide(ConfigLayer));
	const AuthLayer = AuthServiceLive.pipe(
		Layer.provide(Layer.merge(DbLayer, ConfigLayer))
	);
	const VectorDbLayer = VectorDbManagerServiceLive(vectorDbDir).pipe(
		Layer.provide(Layer.merge(ConfigLayer, PlatformLayer)),
		Layer.orDie
	);
	const EmbedLayer = EmbedServiceLive.pipe(Layer.provide(PlatformLayer));
	const FFmpegLayer = FFmpegServiceLive.pipe(Layer.provide(PlatformLayer));
	const ActorManagerLayer = ActorManagerServiceLive;
	const ProcessorLayer = ProcessorServiceLive.pipe(
		Layer.provide(
			Layer.mergeAll(
				DbLayer,
				EmbedLayer,
				FFmpegLayer,
				PlatformLayer,
				thumbCacheLayer
			)
		)
	);
	const JobQueueLayer = JobQueueServiceLive.pipe(
		Layer.provide(Layer.merge(ProcessorLayer, ActorManagerLayer))
	);

	return Layer.mergeAll(
		ConfigLayer,
		PlatformLayer,
		DbLayer,
		AuthLayer,
		VectorDbLayer,
		EmbedLayer,
		FFmpegLayer,
		ProcessorLayer,
		JobQueueLayer,
		ActorManagerLayer,
		thumbCacheLayer
	);
};

export type AppLayer = ReturnType<typeof makeAppLayer>;
export type AppRuntime = ManagedRuntime.ManagedRuntime<
	Layer.Layer.Success<AppLayer>,
	never
>;

export interface TrpcContext {
	runtime: AppRuntime;
	session: { user: { id: string; name: string; email: string } } | null;
	[key: string]: unknown;
}

export async function createTrpcContext(
	honoContext: HonoContext,
	runtime: AppRuntime
): Promise<TrpcContext> {
	const session = await runtime.runPromise(
		Effect.gen(function* () {
			const auth = yield* AuthService;
			return auth.api.getSession({
				headers: honoContext.req.raw.headers,
			});
		})
	);
	return { runtime, session };
}
