import type { Db } from "@indecks/db";
import { job as jobTable } from "@indecks/db/schema/job";
import { library as libraryTable } from "@indecks/db/schema/library";
import { video as videoTable } from "@indecks/db/schema/video";
import { jobMachine } from "@indecks/state/machines/job";
import { and, eq, or } from "drizzle-orm";
import { Context, Effect, Layer, Schedule } from "effect";
import { createActor, toPromise } from "xstate";

export type JobProgressCallback = (
	jobId: string,
	status: string,
	progress: number,
	progressMessage: string | null,
	errorMessage: string | null
) => void;

let onJobProgress: JobProgressCallback | undefined;

export const setJobProgressCallback = (cb: JobProgressCallback) => {
	onJobProgress = cb;
};

const activeActors = new Map<
	string,
	ReturnType<typeof createActor<typeof jobMachine>>
>();

const MAX_RETRIES = 3;

const claimNextJob = (db: Db) =>
	Effect.tryPromise({
		try: async () => {
			const pending = await db
				.select()
				.from(jobTable)
				.where(eq(jobTable.status, "pending"))
				.orderBy(jobTable.createdAt)
				.limit(1)
				.get();

			if (!pending) {
				return null;
			}

			await db
				.update(jobTable)
				.set({ status: "running", startedAt: new Date() })
				.where(
					and(eq(jobTable.id, pending.id), eq(jobTable.status, "pending"))
				);

			const claimed = await db
				.select()
				.from(jobTable)
				.where(and(eq(jobTable.id, pending.id), eq(jobTable.status, "running")))
				.get();

			return claimed ?? null;
		},
		catch: (e) => e,
	}).pipe(
		Effect.catchAll((err) =>
			Effect.logWarning(`Job claim failed: ${err}`).pipe(Effect.as(null))
		)
	);

const completeJob = (db: Db, jobId: string, jobType?: string) =>
	Effect.promise(() =>
		db
			.update(jobTable)
			.set({
				status: "completed",
				progress: 100,
				completedAt: new Date(),
			})
			.where(eq(jobTable.id, jobId))
	).pipe(
		Effect.tap(() => {
			const message =
				jobType === "scan_library" ? "Scan complete." : "Indexing complete.";
			return Effect.sync(() =>
				onJobProgress?.(jobId, "completed", 100, message, null)
			);
		}),
		Effect.catchAll((err) =>
			Effect.logError(`Failed to complete job ${jobId}: ${err}`)
		)
	);

const failJob = (db: Db, jobId: string, error: string) =>
	Effect.promise(() =>
		db
			.update(jobTable)
			.set({
				status: "failed",
				errorMessage: error,
				completedAt: new Date(),
			})
			.where(eq(jobTable.id, jobId))
	).pipe(
		Effect.tap(() =>
			Effect.sync(() => onJobProgress?.(jobId, "failed", 0, null, error))
		),
		Effect.catchAll((err) =>
			Effect.logError(`Failed to mark job ${jobId} as failed: ${err}`)
		)
	);

const resetVideoStatuses = (
	db: Db,
	jobRow: typeof jobTable.$inferSelect,
	errorMsg: string
) =>
	Effect.gen(function* () {
		if (jobRow.videoId && jobRow.type === "index_video") {
			yield* Effect.promise(() =>
				db
					.update(videoTable)
					.set({ status: "error", errorMessage: errorMsg })
					.where(eq(videoTable.id, jobRow.videoId as string))
			).pipe(Effect.ignore);
		}
		if (jobRow.libraryId && jobRow.type === "index_library") {
			yield* Effect.promise(() =>
				db
					.update(videoTable)
					.set({ status: "pending", errorMessage: null })
					.where(
						and(
							eq(videoTable.libraryId, jobRow.libraryId as string),
							eq(videoTable.status, "processing")
						)
					)
			).pipe(Effect.ignore);
		}
	});

const handleCancellation = (db: Db, jobRow: typeof jobTable.$inferSelect) =>
	Effect.gen(function* () {
		yield* Effect.logWarning(`Job ${jobRow.id} cancelled`).pipe(
			Effect.annotateLogs("jobType", jobRow.type)
		);

		yield* failJob(db, jobRow.id, "Job cancelled");
		if (jobRow.videoId) {
			yield* Effect.promise(() =>
				db
					.update(videoTable)
					.set({ status: "pending", errorMessage: null })
					.where(eq(videoTable.id, jobRow.videoId as string))
			).pipe(Effect.ignore);
		}
		if (jobRow.libraryId) {
			yield* Effect.promise(() =>
				db
					.update(videoTable)
					.set({ status: "pending", errorMessage: null })
					.where(
						and(
							eq(videoTable.libraryId, jobRow.libraryId as string),
							eq(videoTable.status, "processing")
						)
					)
			).pipe(Effect.ignore);
			yield* Effect.promise(() =>
				db
					.update(libraryTable)
					.set({ status: "idle" })
					.where(eq(libraryTable.id, jobRow.libraryId as string))
			).pipe(Effect.ignore);
		}
	});

const runJob = (db: Db, jobRow: typeof jobTable.$inferSelect) =>
	Effect.gen(function* () {
		const actor = createActor(jobMachine, {
			input: {
				jobType: jobRow.type as
					| "scan_library"
					| "index_library"
					| "index_video",
				libraryId: jobRow.libraryId,
				videoId: jobRow.videoId,
				indexerId: jobRow.indexerId,
				jobId: jobRow.id,
				maxRetries: MAX_RETRIES,
			},
		});

		activeActors.set(jobRow.id, actor);

		// Forward actor state changes to SSE
		actor.subscribe((snapshot) => {
			const { progress, progressMessage, errorMessage } = snapshot.context;
			const state = snapshot.value as string;
			onJobProgress?.(
				jobRow.id,
				state,
				progress,
				progressMessage,
				errorMessage
			);
		});

		actor.start();
		actor.send({ type: "CLAIM" });

		// Wait for the machine to reach a final state (completed | failed | cancelled)
		yield* Effect.promise(() => toPromise(actor));

		const finalSnapshot = actor.getSnapshot();
		const finalState = finalSnapshot.value as string;
		const { errorMessage } = finalSnapshot.context;

		switch (finalState) {
			case "completed":
				yield* completeJob(db, jobRow.id, jobRow.type);
				break;
			case "failed":
				yield* failJob(db, jobRow.id, errorMessage ?? "Unknown error");
				yield* resetVideoStatuses(db, jobRow, errorMessage ?? "Unknown error");
				if (jobRow.libraryId) {
					yield* Effect.promise(() =>
						db
							.update(libraryTable)
							.set({ status: "error" })
							.where(eq(libraryTable.id, jobRow.libraryId as string))
					).pipe(Effect.ignore);
				}
				break;
			case "cancelled":
				yield* handleCancellation(db, jobRow);
				break;
			default:
				yield* Effect.logWarning(
					`Job ${jobRow.id} ended in unexpected state: ${finalState}`
				);
				break;
		}

		activeActors.delete(jobRow.id);
	});

export interface JobQueueServiceShape {
	readonly failStaleJobs: (db: Db) => Effect.Effect<number>;
	readonly startWorker: (db: Db) => Effect.Effect<void>;
}

export class JobQueueService extends Context.Tag("JobQueueService")<
	JobQueueService,
	JobQueueServiceShape
>() {}

export const JobQueueServiceLive = Layer.succeed(JobQueueService, {
	failStaleJobs: (db) =>
		Effect.gen(function* () {
			const errorMsg = "Server restarted while job was running";

			// Fail running and cancelled jobs
			const result = yield* Effect.promise(() =>
				db
					.update(jobTable)
					.set({
						status: "failed",
						errorMessage: errorMsg,
						completedAt: new Date(),
					})
					.where(
						or(eq(jobTable.status, "running"), eq(jobTable.status, "cancelled"))
					)
			);

			// Reset in-flight video statuses
			yield* Effect.promise(() =>
				db
					.update(videoTable)
					.set({ status: "pending", errorMessage: null })
					.where(eq(videoTable.status, "processing"))
			);

			// Reset in-flight library statuses
			yield* Effect.promise(() =>
				db
					.update(libraryTable)
					.set({ status: "idle" })
					.where(
						or(
							eq(libraryTable.status, "scanning"),
							eq(libraryTable.status, "indexing")
						)
					)
			);

			return result.rowsAffected;
		}).pipe(
			Effect.catchAll((err) =>
				Effect.logError(`Stale job cleanup failed: ${err}`).pipe(Effect.as(0))
			)
		),

	startWorker: (db) =>
		Effect.gen(function* () {
			const pollOnce = Effect.gen(function* () {
				const jobRow = yield* claimNextJob(db);
				if (jobRow) {
					yield* Effect.logInfo(`Claimed job ${jobRow.id} (${jobRow.type})`);
					yield* runJob(db, jobRow);
					yield* Effect.logInfo(`Finished job ${jobRow.id}`);
				}
			});

			yield* Effect.logInfo("Worker poll loop starting");
			yield* pollOnce.pipe(
				Effect.catchAll((err) =>
					Effect.logError("Worker poll error").pipe(
						Effect.annotateLogs("error", String(err))
					)
				),
				Effect.catchAllDefect((err) =>
					Effect.logError("Worker poll defect").pipe(
						Effect.annotateLogs("defect", String(err))
					)
				),
				Effect.repeat(Schedule.spaced("3 seconds")),
				Effect.asVoid
			);
		}),
});
