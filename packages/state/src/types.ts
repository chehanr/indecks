export type VideoStatus = "pending" | "processing" | "indexed" | "error";

export type LibraryStatus =
	| "idle"
	| "scanning"
	| "indexing"
	| "ready"
	| "error";

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
