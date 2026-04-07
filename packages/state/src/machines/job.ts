import { assign, type EventObject, fromCallback, setup } from "xstate";

import { getJobExecutor, type JobExecutorInput } from "../bridge";

export const jobMachine = setup({
	types: {
		context: {} as {
			jobType:
				| "scan_library"
				| "index_library"
				| "index_video"
				| "regenerate_thumbnails"
				| "generate_missing_thumbnails";
			libraryId: string | null;
			videoId: string | null;
			indexerId: string | null;
			jobId: string;
			retryCount: number;
			maxRetries: number;
			progress: number;
			progressMessage: string | null;
			errorMessage: string | null;
		},
		events: {} as
			| { type: "CLAIM" }
			| { type: "CANCEL" }
			| { type: "PROGRESS"; progress: number; message: string }
			| { type: "JOB_DONE" }
			| { type: "JOB_ERROR"; error: string },
		input: {} as {
			jobType:
				| "scan_library"
				| "index_library"
				| "index_video"
				| "regenerate_thumbnails"
				| "generate_missing_thumbnails";
			libraryId: string | null;
			videoId: string | null;
			indexerId: string | null;
			jobId: string;
			maxRetries?: number;
		},
	},
	guards: {
		canRetry: ({ context }) => context.retryCount < context.maxRetries,
	},
	actions: {
		incrementRetry: assign({
			retryCount: ({ context }) => context.retryCount + 1,
		}),
		setError: assign({
			errorMessage: (_, params: { error: string }) => params.error,
		}),
		clearError: assign({
			errorMessage: null,
			progress: 0,
			progressMessage: null,
		}),
		updateProgress: assign({
			progress: (_, params: { progress: number; message: string }) =>
				params.progress,
			progressMessage: (_, params: { progress: number; message: string }) =>
				params.message,
		}),
	},
	actors: {
		executeJob: fromCallback<EventObject, JobExecutorInput>(
			({ sendBack, input }) => {
				let stopped = false;

				try {
					const executor = getJobExecutor();
					executor(input, {
						onProgress: (progress, message) => {
							if (!stopped) {
								sendBack({ type: "PROGRESS", progress, message });
							}
						},
					}).then(
						() => {
							if (!stopped) {
								sendBack({ type: "JOB_DONE" });
							}
						},
						(err) => {
							if (stopped) {
								return;
							}
							// Detect cancellation errors (from processor's checkCancelled)
							const isCancelled =
								typeof err === "object" &&
								err !== null &&
								"_tag" in err &&
								(err as { _tag: string })._tag === "JobCancelledError";
							if (isCancelled) {
								sendBack({ type: "CANCEL" });
							} else {
								sendBack({
									type: "JOB_ERROR",
									error: err instanceof Error ? err.message : String(err),
								});
							}
						}
					);
				} catch (err) {
					if (!stopped) {
						sendBack({
							type: "JOB_ERROR",
							error: err instanceof Error ? err.message : String(err),
						});
					}
				}

				return () => {
					stopped = true;
				};
			}
		),
	},
	delays: {
		retryDelay: 3000,
	},
}).createMachine({
	id: "job",
	initial: "pending",
	context: ({ input }) => ({
		jobType: input.jobType,
		libraryId: input.libraryId,
		videoId: input.videoId,
		indexerId: input.indexerId,
		jobId: input.jobId,
		retryCount: 0,
		maxRetries: input.maxRetries ?? 3,
		progress: 0,
		progressMessage: null,
		errorMessage: null,
	}),
	states: {
		pending: {
			on: {
				CLAIM: { target: "running", actions: "clearError" },
				CANCEL: "cancelled",
			},
		},
		running: {
			invoke: {
				src: "executeJob",
				input: ({ context }) => ({
					jobType: context.jobType,
					libraryId: context.libraryId,
					videoId: context.videoId,
					indexerId: context.indexerId,
					jobId: context.jobId,
				}),
			},
			on: {
				PROGRESS: {
					actions: {
						type: "updateProgress",
						params: ({ event }) => ({
							progress: event.progress,
							message: event.message,
						}),
					},
				},
				JOB_DONE: "completed",
				JOB_ERROR: [
					{
						guard: "canRetry",
						target: "retrying",
						actions: [
							"incrementRetry",
							{
								type: "setError",
								params: ({ event }) => ({ error: event.error }),
							},
						],
					},
					{
						target: "failed",
						actions: {
							type: "setError",
							params: ({ event }) => ({ error: event.error }),
						},
					},
				],
				CANCEL: "cancelled",
			},
		},
		retrying: {
			after: {
				retryDelay: { target: "running", actions: "clearError" },
			},
			on: {
				CANCEL: "cancelled",
			},
		},
		completed: { type: "final" },
		failed: { type: "final" },
		cancelled: { type: "final" },
	},
});
