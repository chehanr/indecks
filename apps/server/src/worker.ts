import { jobEvents } from "@indecks/api/events";
import { DbService } from "@indecks/db";
import {
	JobQueueService,
	setJobProgressCallback,
} from "@indecks/pipeline/queue";
import type { ManagedRuntime } from "effect";
import { Effect, Fiber, Schedule } from "effect";

export const registerProgressCallback = () => {
	setJobProgressCallback(
		(jobId, status, progress, progressMessage, errorMessage) => {
			jobEvents.emit("progress", {
				jobId,
				status,
				progress,
				progressMessage,
				errorMessage,
			});
		}
	);
};

export const failStaleJobs = (
	appRuntime: ManagedRuntime.ManagedRuntime<JobQueueService | DbService, never>
) =>
	appRuntime.runPromise(
		Effect.gen(function* () {
			const jobQueue = yield* JobQueueService;
			const db = yield* DbService;

			const failed = yield* jobQueue.failStaleJobs(db);
			if (failed > 0) {
				yield* Effect.logInfo(`Marked ${failed} stale jobs as failed`);
			}
		})
	);

export const startWorkerFiber = (
	appRuntime: ManagedRuntime.ManagedRuntime<JobQueueService | DbService, never>
) => {
	const fiber = appRuntime.runFork(
		Effect.gen(function* () {
			yield* Effect.logInfo("Worker fiber started");
			const jobQueue = yield* JobQueueService;
			const db = yield* DbService;
			yield* jobQueue.startWorker(db);
			yield* Effect.logWarning("Worker fiber exited unexpectedly");
		}).pipe(
			Effect.catchAllCause((cause) =>
				Effect.logError("Worker fiber crashed, restarting...").pipe(
					Effect.annotateLogs("cause", cause.toString()),
					Effect.flatMap(() => Effect.fail("worker-crashed" as const))
				)
			),
			Effect.retry(
				Schedule.exponential("1 second").pipe(
					Schedule.union(Schedule.spaced("30 seconds"))
				)
			),
			Effect.annotateLogs("component", "worker")
		)
	);

	return {
		fiber,
		shutdown: async () => {
			await appRuntime
				.runPromise(Fiber.interrupt(fiber))
				.catch(() => undefined);
		},
	};
};
