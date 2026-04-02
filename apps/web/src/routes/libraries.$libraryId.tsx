import { Button } from "@indecks/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@indecks/ui/components/card";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { queryClient, trpc, trpcClient } from "@/utils/trpc";

export const Route = createFileRoute("/libraries/$libraryId")({
	component: LibraryDetailPage,
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data) {
			redirect({ to: "/login", throw: true });
		}
	},
});

function getJobStatusLabel(status: string): string {
	if (status === "completed") {
		return "Indexing complete";
	}
	if (status === "failed") {
		return "Indexing failed";
	}
	return "Indexing...";
}

function getVideoStatusClass(status: string): string {
	if (status === "indexed") {
		return "bg-green-500/10 text-green-500";
	}
	if (status === "processing") {
		return "bg-blue-500/10 text-blue-500";
	}
	if (status === "error") {
		return "bg-red-500/10 text-red-500";
	}
	return "bg-gray-500/10 text-gray-500";
}

function IndexingProgress({ jobId }: { jobId: string }) {
	const jobQuery = useQuery({
		...trpc.job.get.queryOptions({ id: jobId }),
		refetchInterval: (query) => {
			const status = query.state.data?.status;
			if (
				status === "completed" ||
				status === "failed" ||
				status === "cancelled"
			) {
				return false;
			}
			return 2000;
		},
	});

	const job = jobQuery.data;
	if (!job) {
		return null;
	}

	return (
		<Card>
			<CardContent className="py-4">
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<span className="font-medium text-sm">
							{getJobStatusLabel(job.status)}
						</span>
						<span className="text-muted-foreground text-xs">
							{job.progress}%
						</span>
					</div>
					<div className="h-2 rounded-full bg-secondary">
						<div
							className="h-full rounded-full bg-primary transition-all"
							style={{ width: `${job.progress}%` }}
						/>
					</div>
					{job.progressMessage && (
						<p className="text-muted-foreground text-xs">
							{job.progressMessage}
						</p>
					)}
					{job.errorMessage && (
						<p className="text-destructive text-xs">{job.errorMessage}</p>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

function LibraryDetailPage() {
	const { libraryId } = Route.useParams();
	const navigate = useNavigate();

	const libraryQuery = useQuery(
		trpc.library.get.queryOptions({ id: libraryId })
	);
	const videosQuery = useQuery(trpc.library.videos.queryOptions({ libraryId }));
	const jobsQuery = useQuery(
		trpc.job.list.queryOptions({ libraryId, limit: 5 })
	);

	const indexMutation = useMutation({
		mutationFn: () =>
			trpcClient.library.startIndexing.mutate({ id: libraryId }),
		onSuccess: () => {
			toast.success("Indexing started");
			queryClient.invalidateQueries({ queryKey: [["job", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const deleteMutation = useMutation({
		mutationFn: () => trpcClient.library.delete.mutate({ id: libraryId }),
		onSuccess: () => {
			toast.success("Library deleted");
			navigate({ to: "/libraries" });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const library = libraryQuery.data;
	if (libraryQuery.isLoading) {
		return (
			<div className="container mx-auto max-w-3xl px-4 py-6">
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}
	if (!library) {
		return (
			<div className="container mx-auto max-w-3xl px-4 py-6">
				<p className="text-destructive">Library not found</p>
			</div>
		);
	}

	const activeJob = jobsQuery.data?.find(
		(j) => j.status === "pending" || j.status === "running"
	);
	const isIndexing =
		library.status === "scanning" || library.status === "indexing";

	return (
		<div className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-bold text-2xl">{library.name}</h1>
					<p className="text-muted-foreground text-sm">{library.folderPath}</p>
				</div>
				<div className="flex gap-2">
					<Button
						disabled={indexMutation.isPending || isIndexing}
						onClick={() => indexMutation.mutate()}
					>
						{isIndexing ? "Indexing..." : "Start Indexing"}
					</Button>
					<Button
						disabled={deleteMutation.isPending}
						onClick={() => deleteMutation.mutate()}
						variant="destructive"
					>
						Delete
					</Button>
				</div>
			</div>

			{activeJob && <IndexingProgress jobId={activeJob.id} />}

			<Card>
				<CardHeader>
					<CardTitle>Videos ({library.videoCount})</CardTitle>
				</CardHeader>
				<CardContent>
					{videosQuery.isLoading && (
						<p className="text-muted-foreground text-sm">Loading videos...</p>
					)}
					{videosQuery.data?.length === 0 && (
						<p className="text-muted-foreground text-sm">
							No videos found. Start indexing to scan the folder.
						</p>
					)}
					{videosQuery.data && videosQuery.data.length > 0 && (
						<div className="divide-y">
							{videosQuery.data.map((video) => (
								<div
									className="flex items-center justify-between py-2"
									key={video.id}
								>
									<div className="min-w-0 flex-1">
										<p className="truncate font-medium text-sm">
											{video.fileName}
										</p>
										{video.duration != null && (
											<p className="text-muted-foreground text-xs">
												{Math.round(video.duration)}s
											</p>
										)}
									</div>
									<span
										className={`ml-2 rounded-full px-2 py-0.5 text-xs ${getVideoStatusClass(video.status)}`}
									>
										{video.status}
									</span>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
