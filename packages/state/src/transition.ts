import { libraryMachine } from "./machines/library";
import { videoMachine } from "./machines/video";
import type {
	LibraryEvent,
	LibraryStatus,
	VideoEvent,
	VideoStatus,
} from "./types";

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

export const canTransitionLibrary = (
	currentStatus: LibraryStatus,
	event: LibraryEvent
): boolean => {
	const snapshot = libraryMachine.resolveState({ value: currentStatus });
	return snapshot.can(event);
};
