export type JobStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "cancelled";

export type JobType = "scan_library" | "index_video" | "index_library";

export type VideoStatus = "pending" | "processing" | "indexed" | "error";

export type LibraryStatus =
	| "idle"
	| "scanning"
	| "indexing"
	| "ready"
	| "error";

export type ChunkEmbeddingStatus = "pending" | "embedded" | "skipped" | "error";

export type JobEvent =
	| { type: "CLAIM" }
	| { type: "COMPLETE" }
	| { type: "FAIL"; error: string }
	| { type: "CANCEL" }
	| { type: "RECOVER" };

export type VideoEvent =
	| { type: "PROCESS" }
	| { type: "INDEX_SUCCESS" }
	| { type: "INDEX_ERROR"; message: string }
	| { type: "RESET" };

export type LibraryEvent =
	| { type: "START_SCAN" }
	| { type: "SCAN_COMPLETE" }
	| { type: "START_INDEXING" }
	| { type: "INDEX_COMPLETE" }
	| { type: "INDEX_FAIL" }
	| { type: "RESET" };

export type ChunkEvent =
	| { type: "EMBED" }
	| { type: "FAIL" }
	| { type: "SKIP" };
