import { transition } from "xstate";

import { libraryMachine } from "./machines/library";
import { videoMachine } from "./machines/video";
import type {
	LibraryEvent,
	LibraryStatus,
	VideoEvent,
	VideoStatus,
} from "./types";

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
