import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/libraries/$libraryId/")({
	beforeLoad: ({ params }) => {
		redirect({
			to: "/libraries/$libraryId/videos",
			params: { libraryId: params.libraryId },
			throw: true,
		});
	},
});
