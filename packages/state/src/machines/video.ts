import { assign, setup } from "xstate";

export const videoMachine = setup({
	types: {
		context: {} as { errorMessage: string | null },
		events: {} as
			| { type: "PROCESS" }
			| { type: "INDEX_SUCCESS" }
			| { type: "INDEX_ERROR"; message: string }
			| { type: "RESET" },
	},
	actions: {
		setError: assign({
			errorMessage: (_, params: { message: string }) => params.message,
		}),
		clearError: assign({ errorMessage: null }),
	},
}).createMachine({
	id: "video",
	initial: "pending",
	context: { errorMessage: null },
	states: {
		pending: {
			on: {
				PROCESS: { target: "processing", actions: "clearError" },
			},
		},
		processing: {
			on: {
				INDEX_SUCCESS: { target: "indexed", actions: "clearError" },
				INDEX_ERROR: {
					target: "error",
					actions: {
						type: "setError",
						params: ({ event }) => ({ message: event.message }),
					},
				},
				RESET: { target: "pending", actions: "clearError" },
			},
		},
		indexed: {
			on: {
				RESET: { target: "pending", actions: "clearError" },
			},
		},
		error: {
			on: {
				PROCESS: { target: "processing", actions: "clearError" },
				RESET: { target: "pending", actions: "clearError" },
			},
		},
	},
});
