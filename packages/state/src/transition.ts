import { transition } from "xstate";

import { chunkMachine } from "./machines/chunk";
import { jobMachine } from "./machines/job";
import { libraryMachine } from "./machines/library";
import { videoMachine } from "./machines/video";
import type {
	ChunkEmbeddingStatus,
	ChunkEvent,
	JobEvent,
	JobStatus,
	LibraryEvent,
	LibraryStatus,
	VideoEvent,
	VideoStatus,
} from "./types";

// --- Job ---

export const canTransitionJob = (
	currentStatus: JobStatus,
	event: JobEvent,
	context?: { retryCount?: number; maxRetries?: number }
): boolean => {
	const snapshot = jobMachine.resolveState({
		value: currentStatus,
		context: {
			retryCount: context?.retryCount ?? 0,
			maxRetries: context?.maxRetries ?? 3,
			errorMessage: null,
		},
	});
	return snapshot.can(event);
};

export const nextJobStatus = (
	currentStatus: JobStatus,
	event: JobEvent,
	context?: { retryCount?: number; maxRetries?: number }
): JobStatus | null => {
	const snapshot = jobMachine.resolveState({
		value: currentStatus,
		context: {
			retryCount: context?.retryCount ?? 0,
			maxRetries: context?.maxRetries ?? 3,
			errorMessage: null,
		},
	});
	if (!snapshot.can(event)) {
		return null;
	}
	const [next] = transition(jobMachine, snapshot, event);
	return next.value as JobStatus;
};

// --- Video ---

export const canTransitionVideo = (
	currentStatus: VideoStatus,
	event: VideoEvent
): boolean => {
	const snapshot = videoMachine.resolveState({
		value: currentStatus,
		context: { errorMessage: null },
	});
	return snapshot.can(event);
};

export const nextVideoStatus = (
	currentStatus: VideoStatus,
	event: VideoEvent
): VideoStatus | null => {
	const snapshot = videoMachine.resolveState({
		value: currentStatus,
		context: { errorMessage: null },
	});
	if (!snapshot.can(event)) {
		return null;
	}
	const [next] = transition(videoMachine, snapshot, event);
	return next.value as VideoStatus;
};

// --- Library ---

export const canTransitionLibrary = (
	currentStatus: LibraryStatus,
	event: LibraryEvent
): boolean => {
	const snapshot = libraryMachine.resolveState({ value: currentStatus });
	return snapshot.can(event);
};

export const nextLibraryStatus = (
	currentStatus: LibraryStatus,
	event: LibraryEvent
): LibraryStatus | null => {
	const snapshot = libraryMachine.resolveState({ value: currentStatus });
	if (!snapshot.can(event)) {
		return null;
	}
	const [next] = transition(libraryMachine, snapshot, event);
	return next.value as LibraryStatus;
};

// --- Chunk ---

export const canTransitionChunk = (
	currentStatus: ChunkEmbeddingStatus,
	event: ChunkEvent
): boolean => {
	const snapshot = chunkMachine.resolveState({ value: currentStatus });
	return snapshot.can(event);
};

export const nextChunkStatus = (
	currentStatus: ChunkEmbeddingStatus,
	event: ChunkEvent
): ChunkEmbeddingStatus | null => {
	const snapshot = chunkMachine.resolveState({ value: currentStatus });
	if (!snapshot.can(event)) {
		return null;
	}
	const [next] = transition(chunkMachine, snapshot, event);
	return next.value as ChunkEmbeddingStatus;
};
