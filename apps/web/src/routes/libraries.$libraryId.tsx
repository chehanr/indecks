import { Button } from "@indecks/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@indecks/ui/components/card";
import { Input } from "@indecks/ui/components/input";
import { Label } from "@indecks/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

function VideoRow({
	video,
}: {
	video: {
		id: string;
		fileName: string;
		duration: number | null;
		status: string;
	};
}) {
	const reindexMutation = useMutation({
		mutationFn: () =>
			trpcClient.library.reindexVideo.mutate({ videoId: video.id }),
		onSuccess: () => {
			toast.success(`Re-indexing ${video.fileName}`);
			queryClient.invalidateQueries({ queryKey: [["library", "videos"]] });
			queryClient.invalidateQueries({ queryKey: [["job", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	return (
		<div className="flex items-center justify-between py-2">
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium text-sm">{video.fileName}</p>
				{video.duration != null && (
					<p className="text-muted-foreground text-xs">
						{Math.round(video.duration)}s
					</p>
				)}
			</div>
			<div className="ml-2 flex items-center gap-2">
				<span
					className={`rounded-full px-2 py-0.5 text-xs ${getVideoStatusClass(video.status)}`}
				>
					{video.status}
				</span>
				<Button
					disabled={reindexMutation.isPending || video.status === "processing"}
					onClick={() => reindexMutation.mutate()}
					size="sm"
					variant="ghost"
				>
					Re-index
				</Button>
			</div>
		</div>
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

	const updateMutation = useMutation({
		mutationFn: (input: {
			id: string;
			embeddingInstruction?: string;
			embeddingBaseUrl?: string;
			embeddingApiKey?: string;
			embeddingModel?: string;
			embeddingDimensions?: number;
			chunkDuration?: number;
			chunkOverlap?: number;
			downscaleFps?: number;
		}) => trpcClient.library.update.mutate(input),
		onSuccess: () => {
			toast.success("Library updated");
			queryClient.invalidateQueries({ queryKey: [["library", "get"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const testMutation = useMutation({
		mutationFn: (input: {
			embeddingBaseUrl: string;
			embeddingApiKey: string;
			embeddingModel: string;
			embeddingDimensions: number;
		}) => trpcClient.library.testEmbedding.mutate(input),
		onSuccess: (data) => {
			if (data.ok) {
				toast.success("Connection successful");
			} else {
				toast.error(data.error ?? "Connection failed");
			}
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const [instruction, setInstruction] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState("");
	const [dimensions, setDimensions] = useState(768);
	const [chunkDuration, setChunkDuration] = useState(30);
	const [chunkOverlap, setChunkOverlap] = useState(5);
	const [downscaleFps, setDownscaleFps] = useState(5);

	const library = libraryQuery.data;

	useEffect(() => {
		if (library) {
			setInstruction(library.embeddingInstruction ?? "");
			setBaseUrl(library.embeddingBaseUrl ?? "");
			setApiKey(library.embeddingApiKey ?? "");
			setModel(library.embeddingModel ?? "");
			setDimensions(library.embeddingDimensions ?? 768);
			setChunkDuration(library.chunkDuration);
			setChunkOverlap(library.chunkOverlap);
			setDownscaleFps(library.downscaleFps);
		}
	}, [library]);

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

	const hasConfigChanged =
		instruction !== (library.embeddingInstruction ?? "") ||
		baseUrl !== (library.embeddingBaseUrl ?? "") ||
		apiKey !== (library.embeddingApiKey ?? "") ||
		model !== (library.embeddingModel ?? "") ||
		dimensions !== (library.embeddingDimensions ?? 768) ||
		chunkDuration !== library.chunkDuration ||
		chunkOverlap !== library.chunkOverlap ||
		downscaleFps !== library.downscaleFps;

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

			<Card>
				<CardHeader>
					<CardTitle>Embedding Configuration</CardTitle>
				</CardHeader>
				<CardContent>
					<div className="flex flex-col gap-4">
						<div className="flex flex-col gap-2">
							<Label htmlFor="baseUrl">Base URL</Label>
							<Input
								id="baseUrl"
								onChange={(e) => setBaseUrl(e.target.value)}
								placeholder="http://localhost:8000/v1"
								value={baseUrl}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="apiKey">API Key</Label>
							<Input
								id="apiKey"
								onChange={(e) => setApiKey(e.target.value)}
								placeholder="Optional"
								type="password"
								value={apiKey}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="model">Model</Label>
							<Input
								id="model"
								onChange={(e) => setModel(e.target.value)}
								placeholder="Qwen/Qwen3-Embedding-0.6B"
								value={model}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="dimensions">Dimensions</Label>
							<Input
								id="dimensions"
								min={1}
								onChange={(e) =>
									setDimensions(Number.parseInt(e.target.value, 10) || 768)
								}
								type="number"
								value={dimensions}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="instruction">Embedding Instruction</Label>
							<Input
								id="instruction"
								onChange={(e) => setInstruction(e.target.value)}
								placeholder="Represent the visual content."
								value={instruction}
							/>
							<p className="text-muted-foreground text-xs">
								System prompt sent to the embedding model during indexing and
								search. Leave blank for default.
							</p>
						</div>

						<hr />

						<div className="flex flex-col gap-2">
							<Label htmlFor="chunkDuration">Chunk Duration (seconds)</Label>
							<Input
								id="chunkDuration"
								min={1}
								onChange={(e) =>
									setChunkDuration(Number.parseInt(e.target.value, 10) || 30)
								}
								type="number"
								value={chunkDuration}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="chunkOverlap">Chunk Overlap (seconds)</Label>
							<Input
								id="chunkOverlap"
								min={0}
								onChange={(e) =>
									setChunkOverlap(Number.parseInt(e.target.value, 10) || 0)
								}
								type="number"
								value={chunkOverlap}
							/>
							<p className="text-muted-foreground text-xs">
								Overlap between consecutive chunks. Helps avoid missing content
								at boundaries.
							</p>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="downscaleFps">Downscale FPS</Label>
							<Input
								id="downscaleFps"
								min={1}
								onChange={(e) =>
									setDownscaleFps(Number.parseInt(e.target.value, 10) || 5)
								}
								type="number"
								value={downscaleFps}
							/>
							<p className="text-muted-foreground text-xs">
								Frame rate for downscaled chunks before embedding.
							</p>
						</div>
						<div className="flex gap-2">
							<Button
								disabled={updateMutation.isPending || !hasConfigChanged}
								onClick={() =>
									updateMutation.mutate({
										id: libraryId,
										embeddingInstruction: instruction || undefined,
										embeddingBaseUrl: baseUrl || undefined,
										embeddingApiKey: apiKey,
										embeddingModel: model || undefined,
										embeddingDimensions: dimensions,
										chunkDuration,
										chunkOverlap,
										downscaleFps,
									})
								}
								size="sm"
							>
								{updateMutation.isPending ? "Saving..." : "Save"}
							</Button>
							<Button
								disabled={
									!(baseUrl.trim() && model.trim()) || testMutation.isPending
								}
								onClick={() =>
									testMutation.mutate({
										embeddingBaseUrl: baseUrl,
										embeddingApiKey: apiKey,
										embeddingModel: model,
										embeddingDimensions: dimensions,
									})
								}
								size="sm"
								variant="outline"
							>
								{testMutation.isPending ? "Testing..." : "Test Connection"}
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

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
								<VideoRow key={video.id} video={video} />
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
