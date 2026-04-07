import { setup } from "xstate";

export const libraryMachine = setup({
	types: {
		events: {} as
			| { type: "START_SCAN" }
			| { type: "SCAN_COMPLETE" }
			| { type: "START_INDEXING" }
			| { type: "INDEX_COMPLETE" }
			| { type: "INDEX_FAIL" }
			| { type: "RESET" },
	},
}).createMachine({
	id: "library",
	initial: "idle",
	states: {
		idle: {
			on: {
				START_SCAN: { target: "scanning" },
				START_INDEXING: { target: "indexing" },
			},
		},
		scanning: {
			on: {
				SCAN_COMPLETE: { target: "idle" },
				RESET: { target: "idle" },
			},
		},
		indexing: {
			on: {
				INDEX_COMPLETE: { target: "ready" },
				INDEX_FAIL: { target: "error" },
				RESET: { target: "idle" },
			},
		},
		ready: {
			on: {
				START_SCAN: { target: "scanning" },
				START_INDEXING: { target: "indexing" },
			},
		},
		error: {
			on: {
				RESET: { target: "idle" },
				START_SCAN: { target: "scanning" },
				START_INDEXING: { target: "indexing" },
			},
		},
	},
});
