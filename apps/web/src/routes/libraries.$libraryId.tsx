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
import { useState } from "react";
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
		indexedBy: string[];
	};
}) {
	return (
		<div className="flex items-center justify-between py-2">
			<div className="min-w-0 flex-1">
				<p className="truncate font-medium text-sm">{video.fileName}</p>
				<div className="flex items-center gap-2">
					{video.duration != null && (
						<span className="text-muted-foreground text-xs">
							{Math.round(video.duration)}s
						</span>
					)}
					{video.indexedBy.length > 0 && (
						<span className="text-muted-foreground text-xs">
							indexed by: {video.indexedBy.join(", ")}
						</span>
					)}
				</div>
			</div>
			<span
				className={`ml-2 rounded-full px-2 py-0.5 text-xs ${getVideoStatusClass(video.status)}`}
			>
				{video.status}
			</span>
		</div>
	);
}

function AddEmbedderForm({
	libraryId,
	onDone,
}: {
	libraryId: string;
	onDone: () => void;
}) {
	const [name, setName] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState("");
	const [dimensions, setDimensions] = useState(768);
	const [instruction, setInstruction] = useState("");
	const [chunkDuration, setChunkDuration] = useState(30);
	const [chunkOverlap, setChunkOverlap] = useState(5);
	const [downscaleFps, setDownscaleFps] = useState(5);

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.embedder.create.mutate({
				libraryId,
				name,
				baseUrl,
				apiKey: apiKey || undefined,
				model,
				dimensions,
				instruction: instruction || undefined,
				isDefault: true,
				chunkDuration,
				chunkOverlap,
				downscaleFps,
			}),
		onSuccess: () => {
			toast.success("Embedder added");
			queryClient.invalidateQueries({ queryKey: [["embedder", "list"]] });
			onDone();
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const testMutation = useMutation({
		mutationFn: () =>
			trpcClient.embedder.test.mutate({
				baseUrl,
				apiKey,
				model,
				dimensions,
			}),
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

	const canSubmit = name.trim() && baseUrl.trim() && model.trim();

	return (
		<div className="flex flex-col gap-4 rounded-md border p-4">
			<div className="flex flex-col gap-2">
				<Label htmlFor="emb-name">Name</Label>
				<Input
					id="emb-name"
					onChange={(e) => setName(e.target.value)}
					placeholder="Jina CLIP v2"
					value={name}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="emb-baseUrl">Base URL</Label>
				<Input
					id="emb-baseUrl"
					onChange={(e) => setBaseUrl(e.target.value)}
					placeholder="http://localhost:8000/v1"
					value={baseUrl}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="emb-apiKey">API Key</Label>
				<Input
					id="emb-apiKey"
					onChange={(e) => setApiKey(e.target.value)}
					placeholder="Optional"
					type="password"
					value={apiKey}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="emb-model">Model</Label>
				<Input
					id="emb-model"
					onChange={(e) => setModel(e.target.value)}
					placeholder="Qwen/Qwen3-Embedding-0.6B"
					value={model}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="emb-dimensions">Dimensions</Label>
				<Input
					id="emb-dimensions"
					min={1}
					onChange={(e) =>
						setDimensions(Number.parseInt(e.target.value, 10) || 768)
					}
					type="number"
					value={dimensions}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="emb-instruction">
					Embedding Instruction (optional)
				</Label>
				<Input
					id="emb-instruction"
					onChange={(e) => setInstruction(e.target.value)}
					placeholder="Represent the visual content."
					value={instruction}
				/>
			</div>

			<hr />

			<div className="flex flex-col gap-2">
				<Label htmlFor="emb-chunkDuration">Chunk Duration (seconds)</Label>
				<Input
					id="emb-chunkDuration"
					min={1}
					onChange={(e) =>
						setChunkDuration(Number.parseInt(e.target.value, 10) || 30)
					}
					type="number"
					value={chunkDuration}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="emb-chunkOverlap">Chunk Overlap (seconds)</Label>
				<Input
					id="emb-chunkOverlap"
					min={0}
					onChange={(e) =>
						setChunkOverlap(Number.parseInt(e.target.value, 10) || 0)
					}
					type="number"
					value={chunkOverlap}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor="emb-downscaleFps">Downscale FPS</Label>
				<Input
					id="emb-downscaleFps"
					min={1}
					onChange={(e) =>
						setDownscaleFps(Number.parseInt(e.target.value, 10) || 5)
					}
					type="number"
					value={downscaleFps}
				/>
			</div>
			<div className="flex gap-2">
				<Button
					disabled={!canSubmit || createMutation.isPending}
					onClick={() => createMutation.mutate()}
					size="sm"
				>
					{createMutation.isPending ? "Adding..." : "Add Embedder"}
				</Button>
				<Button
					disabled={!(baseUrl.trim() && model.trim()) || testMutation.isPending}
					onClick={() => testMutation.mutate()}
					size="sm"
					variant="outline"
				>
					{testMutation.isPending ? "Testing..." : "Test Connection"}
				</Button>
				<Button onClick={onDone} size="sm" variant="ghost">
					Cancel
				</Button>
			</div>
		</div>
	);
}

function EditEmbedderForm({
	embedder,
	onDone,
}: {
	embedder: {
		id: string;
		name: string;
		baseUrl: string;
		apiKey: string | null;
		model: string;
		dimensions: number;
		instruction: string | null;
		chunkDuration: number;
		chunkOverlap: number;
		downscaleFps: number;
	};
	onDone: () => void;
}) {
	const [name, setName] = useState(embedder.name);
	const [baseUrl, setBaseUrl] = useState(embedder.baseUrl);
	const [apiKey, setApiKey] = useState(embedder.apiKey ?? "");
	const [model, setModel] = useState(embedder.model);
	const [dimensions, setDimensions] = useState(embedder.dimensions);
	const [instruction, setInstruction] = useState(embedder.instruction ?? "");
	const [chunkDuration, setChunkDuration] = useState(embedder.chunkDuration);
	const [chunkOverlap, setChunkOverlap] = useState(embedder.chunkOverlap);
	const [downscaleFps, setDownscaleFps] = useState(embedder.downscaleFps);

	const updateMutation = useMutation({
		mutationFn: () =>
			trpcClient.embedder.update.mutate({
				id: embedder.id,
				name,
				baseUrl,
				apiKey: apiKey || undefined,
				model,
				dimensions,
				instruction: instruction || undefined,
				chunkDuration,
				chunkOverlap,
				downscaleFps,
			}),
		onSuccess: () => {
			toast.success("Embedder updated");
			queryClient.invalidateQueries({ queryKey: [["embedder", "list"]] });
			onDone();
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const testMutation = useMutation({
		mutationFn: () =>
			trpcClient.embedder.test.mutate({ baseUrl, apiKey, model, dimensions }),
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

	const canSubmit = name.trim() && baseUrl.trim() && model.trim();

	return (
		<div className="flex flex-col gap-4 rounded-md border p-4">
			<div className="flex flex-col gap-2">
				<Label htmlFor={`edit-name-${embedder.id}`}>Name</Label>
				<Input
					id={`edit-name-${embedder.id}`}
					onChange={(e) => setName(e.target.value)}
					value={name}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor={`edit-baseUrl-${embedder.id}`}>Base URL</Label>
				<Input
					id={`edit-baseUrl-${embedder.id}`}
					onChange={(e) => setBaseUrl(e.target.value)}
					value={baseUrl}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor={`edit-apiKey-${embedder.id}`}>API Key</Label>
				<Input
					id={`edit-apiKey-${embedder.id}`}
					onChange={(e) => setApiKey(e.target.value)}
					placeholder="Optional"
					type="password"
					value={apiKey}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor={`edit-model-${embedder.id}`}>Model</Label>
				<Input
					id={`edit-model-${embedder.id}`}
					onChange={(e) => setModel(e.target.value)}
					value={model}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor={`edit-dimensions-${embedder.id}`}>Dimensions</Label>
				<Input
					id={`edit-dimensions-${embedder.id}`}
					min={1}
					onChange={(e) =>
						setDimensions(Number.parseInt(e.target.value, 10) || 768)
					}
					type="number"
					value={dimensions}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor={`edit-instruction-${embedder.id}`}>
					Embedding Instruction (optional)
				</Label>
				<Input
					id={`edit-instruction-${embedder.id}`}
					onChange={(e) => setInstruction(e.target.value)}
					placeholder="Represent the visual content."
					value={instruction}
				/>
			</div>

			<hr />

			<div className="flex flex-col gap-2">
				<Label htmlFor={`edit-chunkDuration-${embedder.id}`}>
					Chunk Duration (seconds)
				</Label>
				<Input
					id={`edit-chunkDuration-${embedder.id}`}
					min={1}
					onChange={(e) =>
						setChunkDuration(Number.parseInt(e.target.value, 10) || 30)
					}
					type="number"
					value={chunkDuration}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor={`edit-chunkOverlap-${embedder.id}`}>
					Chunk Overlap (seconds)
				</Label>
				<Input
					id={`edit-chunkOverlap-${embedder.id}`}
					min={0}
					onChange={(e) =>
						setChunkOverlap(Number.parseInt(e.target.value, 10) || 0)
					}
					type="number"
					value={chunkOverlap}
				/>
			</div>
			<div className="flex flex-col gap-2">
				<Label htmlFor={`edit-downscaleFps-${embedder.id}`}>
					Downscale FPS
				</Label>
				<Input
					id={`edit-downscaleFps-${embedder.id}`}
					min={1}
					onChange={(e) =>
						setDownscaleFps(Number.parseInt(e.target.value, 10) || 5)
					}
					type="number"
					value={downscaleFps}
				/>
			</div>
			<div className="flex gap-2">
				<Button
					disabled={!canSubmit || updateMutation.isPending}
					onClick={() => updateMutation.mutate()}
					size="sm"
				>
					{updateMutation.isPending ? "Saving..." : "Save"}
				</Button>
				<Button
					disabled={!(baseUrl.trim() && model.trim()) || testMutation.isPending}
					onClick={() => testMutation.mutate()}
					size="sm"
					variant="outline"
				>
					{testMutation.isPending ? "Testing..." : "Test Connection"}
				</Button>
				<Button onClick={onDone} size="sm" variant="ghost">
					Cancel
				</Button>
			</div>
		</div>
	);
}

function EmbedderCard({
	embedder,
	libraryId,
}: {
	embedder: {
		id: string;
		name: string;
		baseUrl: string;
		apiKey: string | null;
		model: string;
		dimensions: number;
		instruction: string | null;
		isDefault: boolean;
		chunkDuration: number;
		chunkOverlap: number;
		downscaleFps: number;
	};
	libraryId: string;
}) {
	const [editing, setEditing] = useState(false);

	const deleteMutation = useMutation({
		mutationFn: () => trpcClient.embedder.delete.mutate({ id: embedder.id }),
		onSuccess: () => {
			toast.success(`Deleted ${embedder.name}`);
			queryClient.invalidateQueries({ queryKey: [["embedder", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const setDefaultMutation = useMutation({
		mutationFn: () =>
			trpcClient.embedder.update.mutate({ id: embedder.id, isDefault: true }),
		onSuccess: () => {
			toast.success(`${embedder.name} set as default`);
			queryClient.invalidateQueries({ queryKey: [["embedder", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const indexMutation = useMutation({
		mutationFn: () =>
			trpcClient.library.startIndexing.mutate({
				id: libraryId,
				embedderId: embedder.id,
			}),
		onSuccess: () => {
			toast.success(`Indexing started with ${embedder.name}`);
			queryClient.invalidateQueries({ queryKey: [["job", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	if (editing) {
		return (
			<EditEmbedderForm embedder={embedder} onDone={() => setEditing(false)} />
		);
	}

	return (
		<div className="flex items-center justify-between rounded-md border p-3">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<p className="font-medium text-sm">{embedder.name}</p>
					{embedder.isDefault && (
						<span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary text-xs">
							default
						</span>
					)}
				</div>
				<p className="text-muted-foreground text-xs">
					{embedder.model} ({embedder.dimensions}d) | chunk:{" "}
					{embedder.chunkDuration}s, overlap: {embedder.chunkOverlap}s, fps:{" "}
					{embedder.downscaleFps}
				</p>
				<p className="truncate text-muted-foreground text-xs">
					{embedder.baseUrl}
				</p>
			</div>
			<div className="ml-2 flex items-center gap-1">
				<Button
					disabled={indexMutation.isPending}
					onClick={() => indexMutation.mutate()}
					size="sm"
					variant="ghost"
				>
					Index
				</Button>
				<Button onClick={() => setEditing(true)} size="sm" variant="ghost">
					Edit
				</Button>
				{!embedder.isDefault && (
					<Button
						disabled={setDefaultMutation.isPending}
						onClick={() => setDefaultMutation.mutate()}
						size="sm"
						variant="ghost"
					>
						Set Default
					</Button>
				)}
				<Button
					disabled={deleteMutation.isPending}
					onClick={() => deleteMutation.mutate()}
					size="sm"
					variant="ghost"
				>
					Delete
				</Button>
			</div>
		</div>
	);
}

function LibraryDetailPage() {
	const { libraryId } = Route.useParams();
	const navigate = useNavigate();
	const [showAddForm, setShowAddForm] = useState(false);

	const libraryQuery = useQuery(
		trpc.library.get.queryOptions({ id: libraryId })
	);
	const videosQuery = useQuery(trpc.library.videos.queryOptions({ libraryId }));
	const jobsQuery = useQuery(
		trpc.job.list.queryOptions({ libraryId, limit: 5 })
	);
	const embeddersQuery = useQuery(
		trpc.embedder.list.queryOptions({ libraryId })
	);

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
	return (
		<div className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-bold text-2xl">{library.name}</h1>
					<p className="text-muted-foreground text-sm">{library.folderPath}</p>
				</div>
				<Button
					disabled={deleteMutation.isPending}
					onClick={() => deleteMutation.mutate()}
					variant="destructive"
				>
					Delete
				</Button>
			</div>

			<Card>
				<CardHeader>
					<div className="flex items-center justify-between">
						<CardTitle>Embedders</CardTitle>
						{!showAddForm && (
							<Button
								onClick={() => setShowAddForm(true)}
								size="sm"
								variant="outline"
							>
								Add Embedder
							</Button>
						)}
					</div>
				</CardHeader>
				<CardContent>
					<div className="flex flex-col gap-3">
						{embeddersQuery.data?.map((emb) => (
							<EmbedderCard embedder={emb} key={emb.id} libraryId={libraryId} />
						))}
						{embeddersQuery.data?.length === 0 && !showAddForm && (
							<p className="text-muted-foreground text-sm">
								No embedders configured. Add one to start indexing.
							</p>
						)}
						{showAddForm && (
							<AddEmbedderForm
								libraryId={libraryId}
								onDone={() => setShowAddForm(false)}
							/>
						)}
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
