import { Context, Effect, Layer, Queue } from "effect";

export class JobNotifyService extends Context.Tag("JobNotifyService")<
	JobNotifyService,
	Queue.Queue<void>
>() {}

export const JobNotifyServiceLive = Layer.scoped(
	JobNotifyService,
	Queue.unbounded<void>()
);

export const notifyNewJob = Effect.gen(function* () {
	const queue = yield* JobNotifyService;
	yield* Queue.offer(queue, undefined);
});
