import { createFileRoute, redirect } from "@tanstack/react-router";

import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/libraries/")({
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data) {
			redirect({ to: "/login", throw: true });
		}
	},
});
