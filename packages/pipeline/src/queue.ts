import type { Db } from "@indecks/db";
import { indexer as indexerTable } from "@indecks/db/schema/indexer";
import { job as jobTable } from "@indecks/db/schema/job";
import { library as libraryTable } from "@indecks/db/schema/library";
import { video as videoTable } from "@indecks/db/schema/video";
import type { VectorDbManagerShape } from "@indecks/vector";
import { and, eq, inArray, or } from "drizzle-orm";
import { Context, Effect, Layer, Schedule } from "effect";
import { nanoid } from "nanoid";

import {
	JobCancelledError,
	JobMissingFieldError,
	UnknownJobTypeError,
} from "./errors";
import { ProcessorService } from "./processor";

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
	).pipe(
		Effect.tap(() =>
			Effect.sync(() =>
				onJobProgress?.(jobId, "running", progressVal, message, null)
			)
		),
		Effect.ignore
	);

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
	).pipe(
		Effect.tap(() =>
			Effect.sync(() =>
				onJobProgress?.(jobId, "completed", 100, "Indexing complete.", null)
			)
		),
		Effect.ignore
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
		Effect.ignore
	);

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
		vectorDbManager: VectorDbManagerShape
	) => Effect.Effect<void>;
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
				Effect.gen(function* () {
					const result = yield* Effect.promise(() =>
						db
							.update(jobTable)
							.set({
								status: "pending",
								progressMessage: "Recovered after server restart",
							})
							.where(eq(jobTable.status, "running"))
					);

					yield* Effect.promise(() =>
						db
							.update(videoTable)
							.set({ status: "pending", errorMessage: null })
							.where(eq(videoTable.status, "processing"))
					);

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

					// Create jobs for orphaned pending videos (no active job)
					const pendingVideos = yield* Effect.promise(() =>
						db
							.select({ libraryId: videoTable.libraryId })
							.from(videoTable)
							.where(eq(videoTable.status, "pending"))
							.all()
					);
					const orphanLibraryIds = [
						...new Set(pendingVideos.map((v) => v.libraryId)),
					];

					if (orphanLibraryIds.length > 0) {
						const activeJobs = yield* Effect.promise(() =>
							db
								.select({
									libraryId: jobTable.libraryId,
								})
								.from(jobTable)
								.where(
									and(
										inArray(jobTable.libraryId, orphanLibraryIds),
										or(
											eq(jobTable.status, "pending"),
											eq(jobTable.status, "running")
										)
									)
								)
								.all()
						);
						const activeLibIds = new Set(activeJobs.map((j) => j.libraryId));

						for (const libId of orphanLibraryIds) {
							if (activeLibIds.has(libId)) {
								continue;
							}

							const idxr = yield* Effect.promise(() =>
								db
									.select({ id: indexerTable.id })
									.from(indexerTable)
									.where(eq(indexerTable.libraryId, libId))
									.limit(1)
									.get()
							);
							if (!idxr) {
								continue;
							}

							yield* Effect.promise(() =>
								db.insert(jobTable).values({
									id: nanoid(),
									type: "index_library",
									libraryId: libId,
									indexerId: idxr.id,
									status: "pending",
									progressMessage: "Auto-recovery for pending videos",
								})
							);
						}
					}

					return result.rowsAffected;
				}).pipe(Effect.catchAll(() => Effect.succeed(0))),

			startWorker: (db, vectorDbManager) =>
				Effect.gen(function* () {
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
							if (!jobRow.indexerId) {
								return yield* new JobMissingFieldError({
									jobType: "index_video",
									field: "indexerId",
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
								jobRow.indexerId,
								vectorDbManager,
								jobRow.id,
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
							if (!jobRow.indexerId) {
								return yield* new JobMissingFieldError({
									jobType: "index_library",
									field: "indexerId",
								});
							}
							yield* processor.indexLibrary(
								db,
								vectorDbManager,
								jobRow.libraryId,
								jobRow.indexerId,
								jobRow.id,
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

					const formatErrorMessage = (err: unknown): string => {
						if (err instanceof Error) {
							return err.message;
						}
						if (typeof err === "object" && err !== null && "_tag" in err) {
							return (err as { _tag: string })._tag;
						}
						return String(err);
					};

					const MAX_RETRIES = 3;

					const resetVideoStatuses = (
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

					const failJobWithError = (
						jobRow: typeof jobTable.$inferSelect,
						err: unknown
					) =>
						Effect.gen(function* () {
							const msg = formatErrorMessage(err);

							if (jobRow.retryCount < MAX_RETRIES) {
								yield* Effect.promise(() =>
									db
										.update(jobTable)
										.set({
											status: "pending",
											retryCount: jobRow.retryCount + 1,
											progressMessage: `Retry ${jobRow.retryCount + 1}/${MAX_RETRIES}: ${msg}`,
										})
										.where(eq(jobTable.id, jobRow.id))
								);
								yield* resetVideoStatuses(jobRow, msg);
								yield* Effect.sync(() =>
									onJobProgress?.(
										jobRow.id,
										"pending",
										0,
										`Retrying (${jobRow.retryCount + 1}/${MAX_RETRIES})...`,
										null
									)
								);
								return;
							}

							yield* failJob(db, jobRow.id, msg);
							yield* resetVideoStatuses(jobRow, msg);

							if (jobRow.libraryId) {
								yield* Effect.promise(() =>
									db
										.update(libraryTable)
										.set({ status: "error" })
										.where(eq(libraryTable.id, jobRow.libraryId as string))
								).pipe(Effect.ignore);
							}
						});

					const handleCancellation = (jobRow: typeof jobTable.$inferSelect) =>
						Effect.gen(function* () {
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

					const runJob = (jobRow: typeof jobTable.$inferSelect) =>
						processJob(jobRow).pipe(
							Effect.tap(() => completeJob(db, jobRow.id)),
							Effect.catchIf(
								(err): err is JobCancelledError =>
									err instanceof JobCancelledError,
								() => handleCancellation(jobRow)
							),
							Effect.catchAll((err) => failJobWithError(jobRow, err)),
							Effect.catchAllDefect((err) => failJobWithError(jobRow, err))
						);

					const pollOnce = Effect.gen(function* () {
						const jobRow = yield* claimNextJob(db);
						if (jobRow) {
							yield* runJob(jobRow);
						}
					});

					yield* pollOnce.pipe(
						Effect.catchAll(() => Effect.void),
						Effect.catchAllDefect(() => Effect.void),
						Effect.repeat(Schedule.spaced("3 seconds")),
						Effect.asVoid
					);
				}),
		};
	})
);
