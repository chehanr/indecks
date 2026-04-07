import { DbService } from "@indecks/db";
import { ProcessorService } from "@indecks/pipeline/processor";
import { setJobExecutor } from "@indecks/state/bridge";
import { VectorDbManagerService } from "@indecks/vector";
import type { ManagedRuntime } from "effect";
import { Effect } from "effect";

type JobInput = Parameters<Parameters<typeof setJobExecutor>[0]>[0];
type ProgressFn = (progress: number, message: string) => Effect.Effect<void>;

const requireFields = <K extends keyof JobInput>(
	input: JobInput,
	...fields: K[]
): Record<K, NonNullable<JobInput[K]>> => {
	for (const f of fields) {
		if (!input[f]) {
			throw new Error(`${input.jobType} requires ${f}`);
		}
	}
	return input as Record<K, NonNullable<JobInput[K]>>;
};

const dispatchJob = (input: JobInput, onProgress: ProgressFn) =>
	Effect.gen(function* () {
		const processor = yield* ProcessorService;
		const db = yield* DbService;
		const vectorDbManager = yield* VectorDbManagerService;

		switch (input.jobType) {
			case "scan_library": {
				const r = requireFields(input, "libraryId");
				yield* processor.scanLibraryFolder(db, r.libraryId, onProgress);
				break;
			}
			case "index_video": {
				const r = requireFields(input, "videoId", "indexerId");
				yield* processor.processVideo(
					db,
					r.videoId,
					r.indexerId,
					vectorDbManager,
					input.jobId,
					onProgress
				);
				break;
			}
			case "index_library": {
				const r = requireFields(input, "libraryId", "indexerId");
				yield* processor.indexLibrary(
					db,
					vectorDbManager,
					r.libraryId,
					r.indexerId,
					input.jobId,
					onProgress
				);
				break;
			}
			case "regenerate_thumbnails": {
				const r = requireFields(input, "videoId", "indexerId");
				yield* processor.regenerateThumbnails(
					db,
					r.videoId,
					r.indexerId,
					onProgress
				);
				break;
			}
			case "generate_missing_thumbnails": {
				const r = requireFields(input, "libraryId", "indexerId");
				yield* processor.generateMissingThumbnails(
					db,
					r.libraryId,
					r.indexerId,
					onProgress
				);
				break;
			}
			default:
				throw new Error(`Unknown job type: ${input.jobType}`);
		}
	});

export const registerJobExecutor = (
	appRuntime: ManagedRuntime.ManagedRuntime<
		ProcessorService | DbService | VectorDbManagerService,
		never
	>
) => {
	setJobExecutor(async (input, callbacks) => {
		const onProgress = (progress: number, message: string) =>
			Effect.sync(() => callbacks.onProgress(progress, message));
		await appRuntime.runPromise(dispatchJob(input, onProgress));
	});
};
