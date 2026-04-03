import EventEmitter, { on } from "node:events";

export interface JobProgressEvent {
	errorMessage: string | null;
	jobId: string;
	progress: number;
	progressMessage: string | null;
	status: string;
}

interface JobEvents {
	progress: [event: JobProgressEvent];
}

class JobEventEmitter extends EventEmitter<JobEvents> {
	toIterable(
		eventName: keyof JobEvents,
		opts?: NonNullable<Parameters<typeof on>[2]>
	): AsyncIterable<JobEvents[typeof eventName]> {
		return on(this as never, eventName, opts) as never;
	}
}

export const jobEvents = new JobEventEmitter();
