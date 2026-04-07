import { setup } from "xstate";

export const chunkMachine = setup({
	types: {
		events: {} as { type: "EMBED" } | { type: "FAIL" } | { type: "SKIP" },
	},
}).createMachine({
	id: "chunk",
	initial: "pending",
	states: {
		pending: {
			on: {
				EMBED: { target: "embedded" },
				FAIL: { target: "error" },
				SKIP: { target: "skipped" },
			},
		},
		embedded: { type: "final" },
		error: { type: "final" },
		skipped: { type: "final" },
	},
});
