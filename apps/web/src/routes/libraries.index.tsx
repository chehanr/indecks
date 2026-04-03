import { Button } from "@indecks/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@indecks/ui/components/card";
import { Input } from "@indecks/ui/components/input";
import { Label } from "@indecks/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { queryClient, trpc, trpcClient } from "@/utils/trpc";

export const Route = createFileRoute("/libraries/")({
	component: LibrariesPage,
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data) {
			redirect({ to: "/login", throw: true });
		}
	},
});

function CreateLibraryForm() {
	const [name, setName] = useState("");
	const [folderPath, setFolderPath] = useState("");

	const createMutation = useMutation({
		mutationFn: (input: { name: string; folderPath: string }) =>
			trpcClient.library.create.mutate(input),
		onSuccess: () => {
			toast.success("Library created. Add an embedder to start indexing.");
			setName("");
			setFolderPath("");
			queryClient.invalidateQueries({ queryKey: [["library", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const canSubmit = name && folderPath;

	return (
		<Card>
			<CardHeader>
				<CardTitle>Create Library</CardTitle>
				<CardDescription>
					Point to a local folder containing video files
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						createMutation.mutate({ name, folderPath });
					}}
				>
					<div className="flex flex-col gap-2">
						<Label htmlFor="name">Name</Label>
						<Input
							id="name"
							onChange={(e) => setName(e.target.value)}
							placeholder="My Videos"
							value={name}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="folderPath">Folder Path</Label>
						<Input
							id="folderPath"
							onChange={(e) => setFolderPath(e.target.value)}
							placeholder="/path/to/videos"
							value={folderPath}
						/>
					</div>
					<Button
						disabled={!canSubmit || createMutation.isPending}
						type="submit"
					>
						{createMutation.isPending ? "Creating..." : "Create"}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}

function LibraryCard({
	library,
}: {
	library: {
		id: string;
		name: string;
		folderPath: string;
		status: string;
		videoCount: number;
	};
}) {
	const statusColors: Record<string, string> = {
		idle: "bg-gray-500",
		scanning: "bg-yellow-500",
		indexing: "bg-blue-500",
		ready: "bg-green-500",
		error: "bg-red-500",
	};

	return (
		<Link params={{ libraryId: library.id }} to="/libraries/$libraryId">
			<Card className="transition-colors hover:border-foreground/20">
				<CardHeader>
					<div className="flex items-center justify-between">
						<CardTitle>{library.name}</CardTitle>
						<div className="flex items-center gap-2">
							<div
								className={`h-2 w-2 rounded-full ${statusColors[library.status] ?? "bg-gray-500"}`}
							/>
							<span className="text-muted-foreground text-xs">
								{library.status}
							</span>
						</div>
					</div>
					<CardDescription className="truncate">
						{library.folderPath}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground text-sm">
						{library.videoCount} videos
					</p>
				</CardContent>
			</Card>
		</Link>
	);
}

function LibrariesPage() {
	const librariesQuery = useQuery(trpc.library.list.queryOptions());

	return (
		<div className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
			<h1 className="font-bold text-2xl">Libraries</h1>

			<CreateLibraryForm />

			{librariesQuery.isLoading && (
				<p className="text-muted-foreground">Loading...</p>
			)}

			{librariesQuery.data && librariesQuery.data.length > 0 && (
				<div className="grid gap-4">
					{librariesQuery.data.map((lib) => (
						<LibraryCard key={lib.id} library={lib} />
					))}
				</div>
			)}

			{librariesQuery.data?.length === 0 && (
				<p className="text-muted-foreground">
					No libraries yet. Create one above.
				</p>
			)}
		</div>
	);
}
