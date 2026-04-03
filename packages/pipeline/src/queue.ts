import type { Db } from "@indecks/db";
import { job as jobTable } from "@indecks/db/schema/job";
import { library as libraryTable } from "@indecks/db/schema/library";
import { video as videoTable } from "@indecks/db/schema/video";
import type { VectorDbManagerShape } from "@indecks/vector";
import { and, eq } from "drizzle-orm";
import { Context, Effect, type Fiber, Layer, Schedule } from "effect";

import { JobMissingFieldError, UnknownJobTypeError } from "./errors";
import { ProcessorService } from "./processor";

type ProgressFn = (progress: number, message: string) => Effect.Effect<void>;

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
		catch: () => null,
	}).pipe(Effect.catchAll(() => Effect.succeed(null)));

const updateJobProgress = (
	db: Db,
	jobId: string,
	progressVal: number,
	message: string
) =>
	Effect.promise(() =>
		db
			.update(jobTable)
			.set({ progress: progressVal, progressMessage: message })
			.where(eq(jobTable.id, jobId))
	).pipe(Effect.ignore);

const completeJob = (db: Db, jobId: string) =>
	Effect.promise(() =>
		db
			.update(jobTable)
			.set({
				status: "completed",
				progress: 100,
				completedAt: new Date(),
			})
			.where(eq(jobTable.id, jobId))
	).pipe(Effect.ignore);

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
	).pipe(Effect.ignore);

const resolveLibraryId = (
	db: Db,
	jobRow: typeof jobTable.$inferSelect
): Effect.Effect<string | null> =>
	Effect.gen(function* () {
		if (jobRow.libraryId) {
			return jobRow.libraryId;
		}
		if (jobRow.videoId) {
			const videoId = jobRow.videoId;
			const vid = yield* Effect.promise(() =>
				db
					.select({ libraryId: videoTable.libraryId })
					.from(videoTable)
					.where(eq(videoTable.id, videoId))
					.get()
			);
			return vid?.libraryId ?? null;
		}
		return null;
	});

export interface JobQueueServiceShape {
	readonly recoverStaleJobs: (db: Db) => Effect.Effect<number>;
	readonly startWorker: (
		db: Db,
		vectorDbManager: VectorDbManagerShape,
		pollInterval?: number
	) => Effect.Effect<Fiber.RuntimeFiber<void>>;
}

export class JobQueueService extends Context.Tag("JobQueueService")<
	JobQueueService,
	JobQueueServiceShape
>() {}

export const JobQueueServiceLive = Layer.effect(
	JobQueueService,
	Effect.gen(function* () {
		const processor = yield* ProcessorService;

		return {
			recoverStaleJobs: (db) =>
				Effect.tryPromise({
					try: async () => {
						const result = await db
							.update(jobTable)
							.set({
								status: "pending",
								progressMessage: "Recovered after server restart",
							})
							.where(eq(jobTable.status, "running"));
						return result.rowsAffected;
					},
					catch: () => 0,
				}).pipe(Effect.catchAll(() => Effect.succeed(0))),

			startWorker: (db, vectorDbManager, pollInterval = 3000) => {
				const onProgress =
					(jobId: string): ProgressFn =>
					(progressVal, message) =>
						updateJobProgress(db, jobId, progressVal, message);

				const handleScanLibrary = (jobRow: typeof jobTable.$inferSelect) =>
					Effect.gen(function* () {
						if (!jobRow.libraryId) {
							return yield* new JobMissingFieldError({
								jobType: "scan_library",
								field: "libraryId",
							});
						}
						yield* processor.scanLibraryFolder(
							db,
							jobRow.libraryId,
							onProgress(jobRow.id)
						);
					});

				const handleIndexVideo = (jobRow: typeof jobTable.$inferSelect) =>
					Effect.gen(function* () {
						if (!jobRow.videoId) {
							return yield* new JobMissingFieldError({
								jobType: "index_video",
								field: "videoId",
							});
						}
						if (!jobRow.embedderId) {
							return yield* new JobMissingFieldError({
								jobType: "index_video",
								field: "embedderId",
							});
						}
						const libraryId = yield* resolveLibraryId(db, jobRow);
						if (!libraryId) {
							return yield* new JobMissingFieldError({
								jobType: "index_video",
								field: "libraryId",
							});
						}
						yield* processor.processVideo(
							db,
							jobRow.videoId,
							jobRow.embedderId,
							vectorDbManager,
							onProgress(jobRow.id)
						);
					});

				const handleIndexLibrary = (jobRow: typeof jobTable.$inferSelect) =>
					Effect.gen(function* () {
						if (!jobRow.libraryId) {
							return yield* new JobMissingFieldError({
								jobType: "index_library",
								field: "libraryId",
							});
						}
						if (!jobRow.embedderId) {
							return yield* new JobMissingFieldError({
								jobType: "index_library",
								field: "embedderId",
							});
						}
						yield* processor.indexLibrary(
							db,
							vectorDbManager,
							jobRow.libraryId,
							jobRow.embedderId,
							onProgress(jobRow.id)
						);
					});

				const processJob = (jobRow: typeof jobTable.$inferSelect) =>
					Effect.gen(function* () {
						switch (jobRow.type) {
							case "scan_library":
								yield* handleScanLibrary(jobRow);
								break;
							case "index_video":
								yield* handleIndexVideo(jobRow);
								break;
							case "index_library":
								yield* handleIndexLibrary(jobRow);
								break;
							default:
								return yield* new UnknownJobTypeError({
									jobType: jobRow.type,
								});
						}
					});

				const runJob = (jobRow: typeof jobTable.$inferSelect) =>
					processJob(jobRow).pipe(
						Effect.tap(() => completeJob(db, jobRow.id)),
						Effect.catchAll((err) =>
							Effect.gen(function* () {
								const msg =
									"_tag" in err ? (err as { _tag: string })._tag : String(err);
								yield* failJob(db, jobRow.id, msg);
								if (jobRow.libraryId) {
									yield* Effect.promise(() =>
										db
											.update(libraryTable)
											.set({ status: "error" })
											.where(eq(libraryTable.id, jobRow.libraryId as string))
									).pipe(Effect.ignore);
								}
							})
						)
					);

				const pollOnce = Effect.gen(function* () {
					const jobRow = yield* claimNextJob(db);
					if (jobRow) {
						yield* runJob(jobRow);
					}
				});

				return pollOnce.pipe(
					Effect.repeat(Schedule.spaced(`${pollInterval} millis`)),
					Effect.catchAll(() => Effect.void),
					Effect.asVoid,
					Effect.forkDaemon
				);
			},
		};
	})
);
