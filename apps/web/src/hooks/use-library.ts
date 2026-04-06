import { createContext, useContext } from "react";

export interface LibraryData {
	folderPaths: string;
	id: string;
	name: string;
	scanConcurrency: number;
	status: string;
	videoCount: number;
}

export interface LibraryContextValue {
	library: LibraryData;
	trackedJobIds: string[];
	trackJob: (jobId: string) => void;
}

export const LibraryContext = createContext<LibraryContextValue | null>(null);

export function useLibrary() {
	const ctx = useContext(LibraryContext);
	if (!ctx) {
		throw new Error("useLibrary must be used within LibraryLayout");
	}
	return ctx.library;
}

export function useJobTracking() {
	const ctx = useContext(LibraryContext);
	if (!ctx) {
		throw new Error("useJobTracking must be used within LibraryLayout");
	}
	return { trackedJobIds: ctx.trackedJobIds, trackJob: ctx.trackJob };
}
