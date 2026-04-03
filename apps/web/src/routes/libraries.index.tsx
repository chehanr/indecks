import { Badge } from "@indecks/ui/components/badge";
import { Button } from "@indecks/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@indecks/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@indecks/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@indecks/ui/components/field";
import { Input } from "@indecks/ui/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Plus } from "lucide-react";
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

const statusVariant: Record<
	string,
	"default" | "secondary" | "destructive" | "outline"
> = {
	idle: "secondary",
	scanning: "outline",
	indexing: "outline",
	ready: "default",
	error: "destructive",
};

function CreateLibraryDialog() {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [folderPath, setFolderPath] = useState("");

	const createMutation = useMutation({
		mutationFn: (input: { name: string; folderPath: string }) =>
			trpcClient.library.create.mutate(input),
		onSuccess: () => {
			toast.success("Library created");
			setName("");
			setFolderPath("");
			setOpen(false);
			queryClient.invalidateQueries({ queryKey: [["library", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger
				render={
					<Button size="sm">
						<Plus className="size-4" />
						New Library
					</Button>
				}
			/>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create Library</DialogTitle>
					<DialogDescription>
						Point to a local folder containing video files.
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (name.trim() && folderPath.trim()) {
							createMutation.mutate({ name, folderPath });
						}
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="lib-name">Name</FieldLabel>
							<Input
								id="lib-name"
								onChange={(e) => setName(e.target.value)}
								placeholder="My Videos"
								value={name}
							/>
						</Field>
						<Field>
							<FieldLabel htmlFor="lib-folder">Folder Path</FieldLabel>
							<Input
								id="lib-folder"
								onChange={(e) => setFolderPath(e.target.value)}
								placeholder="/path/to/videos"
								value={folderPath}
							/>
						</Field>
						<Button
							disabled={
								!(name.trim() && folderPath.trim()) || createMutation.isPending
							}
							type="submit"
						>
							{createMutation.isPending ? "Creating..." : "Create"}
						</Button>
					</FieldGroup>
				</form>
			</DialogContent>
		</Dialog>
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
	return (
		<Link params={{ libraryId: library.id }} to="/libraries/$libraryId">
			<Card className="transition-colors hover:border-foreground/20">
				<CardHeader>
					<div className="flex items-center justify-between">
						<CardTitle>{library.name}</CardTitle>
						<Badge variant={statusVariant[library.status] ?? "secondary"}>
							{library.status}
						</Badge>
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
			<div className="flex items-center justify-between">
				<h1 className="font-bold text-2xl">Libraries</h1>
				<CreateLibraryDialog />
			</div>

			{librariesQuery.isLoading && (
				<p className="text-muted-foreground text-sm">Loading...</p>
			)}

			{librariesQuery.data && librariesQuery.data.length > 0 && (
				<div className="grid gap-4">
					{librariesQuery.data.map((lib) => (
						<LibraryCard key={lib.id} library={lib} />
					))}
				</div>
			)}

			{librariesQuery.data?.length === 0 && (
				<p className="text-muted-foreground text-sm">
					No libraries yet. Create one to get started.
				</p>
			)}
		</div>
	);
}
