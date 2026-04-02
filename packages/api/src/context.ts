import { AuthService, AuthServiceLive } from "@indecks/auth";
import { DbServiceLive } from "@indecks/db";
import { ServerConfigLive } from "@indecks/env/server";
import { EmbedServiceLive } from "@indecks/pipeline/embedder";
import { FFmpegServiceLive } from "@indecks/pipeline/ffmpeg";
import { ProcessorServiceLive } from "@indecks/pipeline/processor";
import { JobQueueServiceLive } from "@indecks/pipeline/queue";
import { VectorDbManagerServiceLive } from "@indecks/vector";
import { Effect, Layer, type ManagedRuntime } from "effect";
import type { Context as HonoContext } from "hono";

export const makeAppLayer = (vectorDbDir: string) => {
	const ConfigLayer = ServerConfigLive;
	const DbLayer = DbServiceLive.pipe(Layer.provide(ConfigLayer));
	const AuthLayer = AuthServiceLive.pipe(
		Layer.provide(Layer.merge(DbLayer, ConfigLayer))
	);
	const VectorDbLayer = VectorDbManagerServiceLive(vectorDbDir).pipe(
		Layer.provide(ConfigLayer),
		Layer.orDie
	);
	const EmbedLayer = EmbedServiceLive;
	const FFmpegLayer = FFmpegServiceLive;
	const ProcessorLayer = ProcessorServiceLive.pipe(
		Layer.provide(Layer.mergeAll(DbLayer, EmbedLayer, FFmpegLayer))
	);
	const JobQueueLayer = JobQueueServiceLive.pipe(Layer.provide(ProcessorLayer));

	return Layer.mergeAll(
		ConfigLayer,
		DbLayer,
		AuthLayer,
		VectorDbLayer,
		EmbedLayer,
		FFmpegLayer,
		ProcessorLayer,
		JobQueueLayer
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
