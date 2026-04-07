export interface JobExecutorInput {
	indexerId: string | null;
	jobId: string;
	jobType: "scan_library" | "index_library" | "index_video";
	libraryId: string | null;
	videoId: string | null;
}

export interface JobExecutorCallbacks {
	onProgress: (progress: number, message: string) => void;
}

export type JobExecutorFn = (
	input: JobExecutorInput,
	callbacks: JobExecutorCallbacks
) => Promise<void>;

let executor: JobExecutorFn | null = null;

export const setJobExecutor = (fn: JobExecutorFn): void => {
	executor = fn;
};

export const getJobExecutor = (): JobExecutorFn => {
	if (!executor) {
		throw new Error(
			"Job executor not registered. Call setJobExecutor() at startup."
		);
	}
	return executor;
};
