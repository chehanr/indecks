import { assign, setup } from "xstate";

export const jobMachine = setup({
	types: {
		context: {} as {
			retryCount: number;
			maxRetries: number;
			errorMessage: string | null;
		},
		events: {} as
			| { type: "CLAIM" }
			| { type: "COMPLETE" }
			| { type: "FAIL"; error: string }
			| { type: "CANCEL" }
			| { type: "RECOVER" },
	},
	guards: {
		canRetry: ({ context }) => context.retryCount < context.maxRetries,
		exhaustedRetries: ({ context }) => context.retryCount >= context.maxRetries,
	},
	actions: {
		incrementRetry: assign({
			retryCount: ({ context }) => context.retryCount + 1,
		}),
		setError: assign({
			errorMessage: (_, params: { error: string }) => params.error,
		}),
		clearError: assign({ errorMessage: null }),
	},
}).createMachine({
	id: "job",
	initial: "pending",
	context: { retryCount: 0, maxRetries: 3, errorMessage: null },
	states: {
		pending: {
			on: {
				CLAIM: { target: "running", actions: "clearError" },
				CANCEL: { target: "cancelled" },
			},
		},
		running: {
			on: {
				COMPLETE: { target: "completed" },
				FAIL: [
					{
						guard: "canRetry",
						target: "pending",
						actions: [
							"incrementRetry",
							{
								type: "setError",
								params: ({ event }) => ({ error: event.error }),
							},
						],
					},
					{
						guard: "exhaustedRetries",
						target: "failed",
						actions: {
							type: "setError",
							params: ({ event }) => ({ error: event.error }),
						},
					},
				],
				CANCEL: { target: "cancelled" },
				RECOVER: { target: "pending", actions: "clearError" },
			},
		},
		completed: { type: "final" },
		failed: { type: "final" },
		cancelled: {
			on: {
				RECOVER: { target: "pending" },
			},
		},
	},
});
