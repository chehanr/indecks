import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@indecks/ui/components/alert-dialog";
import { Badge } from "@indecks/ui/components/badge";
import { Button } from "@indecks/ui/components/button";
import { Card, CardContent } from "@indecks/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@indecks/ui/components/dialog";
import {
	Field,
	FieldGroup,
	FieldLabel,
	FieldSeparator,
} from "@indecks/ui/components/field";
import { Input } from "@indecks/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@indecks/ui/components/native-select";
import {
	Progress,
	ProgressLabel,
	ProgressValue,
} from "@indecks/ui/components/progress";
import { Separator } from "@indecks/ui/components/separator";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@indecks/ui/components/tabs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useRef, useState } from "react";
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

// --- Indexing Progress ---

function IndexingProgress({ jobId }: { jobId: string }) {
	const [wasActive, setWasActive] = useState(true);

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
	const isDone =
		job?.status === "completed" ||
		job?.status === "failed" ||
		job?.status === "cancelled";

	if (wasActive && isDone) {
		setWasActive(false);
		queryClient.invalidateQueries({ queryKey: [["library", "videos"]] });
		queryClient.invalidateQueries({ queryKey: [["library", "get"]] });
	}

	if (!job) {
		return null;
	}

	let statusLabel = "Indexing...";
	if (job.status === "completed") {
		statusLabel = "Indexing complete";
	} else if (job.status === "failed") {
		statusLabel = "Indexing failed";
	}

	return (
		<Card>
			<CardContent className="py-4">
				<Progress value={job.progress}>
					<ProgressLabel>{statusLabel}</ProgressLabel>
					<ProgressValue />
				</Progress>
				{job.progressMessage && (
					<p className="mt-2 text-muted-foreground text-xs">
						{job.progressMessage}
					</p>
				)}
				{job.errorMessage && (
					<p className="mt-2 text-destructive text-xs">{job.errorMessage}</p>
				)}
			</CardContent>
		</Card>
	);
}

// --- Videos Tab ---

const videoStatusVariant: Record<
	string,
	"default" | "outline" | "destructive" | "secondary"
> = {
	indexed: "default",
	processing: "outline",
	error: "destructive",
};

function VideoStatusBadge({ status }: { status: string }) {
	return (
		<Badge variant={videoStatusVariant[status] ?? "secondary"}>{status}</Badge>
	);
}

function IndexVideoDialog({
	videoId,
	embedders,
	onJobStarted,
}: {
	videoId: string;
	embedders: {
		id: string;
		name: string;
		model: string;
		dimensions: number;
		isDefault: boolean;
	}[];
	onJobStarted?: (jobId: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [selectedId, setSelectedId] = useState("");

	const indexMutation = useMutation({
		mutationFn: () =>
			trpcClient.library.reindexVideo.mutate({
				videoId,
				embedderId: selectedId,
			}),
		onSuccess: (data) => {
			toast.success("Indexing started");
			onJobStarted?.(data.jobId);
			queryClient.invalidateQueries({ queryKey: [["job", "list"]] });
			queryClient.invalidateQueries({ queryKey: [["library", "videos"]] });
			setOpen(false);
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const handleOpen = (next: boolean) => {
		setOpen(next);
		if (next) {
			const def = embedders.find((e) => e.isDefault);
			setSelectedId(def?.id ?? embedders[0]?.id ?? "");
		}
	};

	return (
		<Dialog onOpenChange={handleOpen} open={open}>
			<DialogTrigger
				render={
					<Button size="xs" variant="outline">
						Index
					</Button>
				}
			/>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Index Video</DialogTitle>
				</DialogHeader>
				<div className="flex flex-col gap-3">
					<NativeSelect
						className="w-full"
						onChange={(e) => setSelectedId(e.target.value)}
						value={selectedId}
					>
						{embedders.map((emb) => (
							<NativeSelectOption key={emb.id} value={emb.id}>
								{emb.name} ({emb.model}, {emb.dimensions}d)
								{emb.isDefault ? " — default" : ""}
							</NativeSelectOption>
						))}
					</NativeSelect>
					<Button
						disabled={!selectedId || indexMutation.isPending}
						onClick={() => indexMutation.mutate()}
					>
						{indexMutation.isPending ? "Starting..." : "Start Indexing"}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function VideoRow({
	video,
	embedders,
	onJobStarted,
}: {
	video: {
		id: string;
		fileName: string;
		duration: number | null;
		status: string;
		indexedBy: string[];
	};
	embedders: {
		id: string;
		name: string;
		model: string;
		dimensions: number;
		isDefault: boolean;
	}[];
	onJobStarted?: (jobId: string) => void;
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
			<div className="ml-2 flex items-center gap-2">
				{embedders.length > 0 && (
					<IndexVideoDialog
						embedders={embedders}
						onJobStarted={onJobStarted}
						videoId={video.id}
					/>
				)}
				<VideoStatusBadge status={video.status} />
			</div>
		</div>
	);
}

function VideosTab({
	libraryId,
	videoCount,
	onJobStarted,
}: {
	libraryId: string;
	videoCount: number;
	onJobStarted?: (jobId: string) => void;
}) {
	const videosQuery = useQuery(trpc.library.videos.queryOptions({ libraryId }));
	const embeddersQuery = useQuery(
		trpc.embedder.list.queryOptions({ libraryId })
	);
	const embedders = (embeddersQuery.data ?? []).map((e) => ({
		id: e.id,
		name: e.name,
		model: e.model,
		dimensions: e.dimensions,
		isDefault: e.isDefault,
	}));

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h2 className="font-medium text-sm">{videoCount} videos</h2>
			</div>
			{videosQuery.isLoading && (
				<p className="text-muted-foreground text-sm">Loading videos...</p>
			)}
			{videosQuery.data?.length === 0 && (
				<p className="text-muted-foreground text-sm">
					No videos found. Add an embedder and start indexing.
				</p>
			)}
			{videosQuery.data && videosQuery.data.length > 0 && (
				<div className="divide-y">
					{videosQuery.data.map((video) => (
						<VideoRow
							embedders={embedders}
							key={video.id}
							onJobStarted={onJobStarted}
							video={video}
						/>
					))}
				</div>
			)}
		</div>
	);
}

// --- Embedders Tab ---

function EmbedderFormFields({
	values,
	onChange,
	idPrefix,
}: {
	values: {
		name: string;
		baseUrl: string;
		apiKey: string;
		model: string;
		dimensions: number;
		instruction: string;
		chunkDuration: number;
		chunkOverlap: number;
		downscaleFps: number;
	};
	onChange: (field: string, value: string | number) => void;
	idPrefix: string;
}) {
	return (
		<>
			<Field>
				<FieldLabel htmlFor={`${idPrefix}-name`}>Name</FieldLabel>
				<Input
					id={`${idPrefix}-name`}
					onChange={(e) => onChange("name", e.target.value)}
					placeholder="Jina CLIP v2"
					value={values.name}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={`${idPrefix}-baseUrl`}>Base URL</FieldLabel>
				<Input
					id={`${idPrefix}-baseUrl`}
					onChange={(e) => onChange("baseUrl", e.target.value)}
					placeholder="http://localhost:8000/v1"
					value={values.baseUrl}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={`${idPrefix}-apiKey`}>API Key</FieldLabel>
				<Input
					id={`${idPrefix}-apiKey`}
					onChange={(e) => onChange("apiKey", e.target.value)}
					placeholder="Optional"
					type="password"
					value={values.apiKey}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={`${idPrefix}-model`}>Model</FieldLabel>
				<Input
					id={`${idPrefix}-model`}
					onChange={(e) => onChange("model", e.target.value)}
					placeholder="Qwen/Qwen3-Embedding-0.6B"
					value={values.model}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={`${idPrefix}-dimensions`}>Dimensions</FieldLabel>
				<Input
					id={`${idPrefix}-dimensions`}
					min={1}
					onChange={(e) =>
						onChange("dimensions", Number.parseInt(e.target.value, 10) || 768)
					}
					type="number"
					value={values.dimensions}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={`${idPrefix}-instruction`}>
					Embedding Instruction (optional)
				</FieldLabel>
				<Input
					id={`${idPrefix}-instruction`}
					onChange={(e) => onChange("instruction", e.target.value)}
					placeholder="Represent the visual content."
					value={values.instruction}
				/>
			</Field>
			<FieldSeparator />
			<Field>
				<FieldLabel htmlFor={`${idPrefix}-chunkDuration`}>
					Chunk Duration (seconds)
				</FieldLabel>
				<Input
					id={`${idPrefix}-chunkDuration`}
					min={1}
					onChange={(e) =>
						onChange("chunkDuration", Number.parseInt(e.target.value, 10) || 30)
					}
					type="number"
					value={values.chunkDuration}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={`${idPrefix}-chunkOverlap`}>
					Chunk Overlap (seconds)
				</FieldLabel>
				<Input
					id={`${idPrefix}-chunkOverlap`}
					min={0}
					onChange={(e) =>
						onChange("chunkOverlap", Number.parseInt(e.target.value, 10) || 0)
					}
					type="number"
					value={values.chunkOverlap}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={`${idPrefix}-downscaleFps`}>
					Downscale FPS
				</FieldLabel>
				<Input
					id={`${idPrefix}-downscaleFps`}
					min={1}
					onChange={(e) =>
						onChange("downscaleFps", Number.parseInt(e.target.value, 10) || 5)
					}
					type="number"
					value={values.downscaleFps}
				/>
			</Field>
		</>
	);
}

function useEmbedderFormState(initial?: {
	name: string;
	baseUrl: string;
	apiKey: string | null;
	model: string;
	dimensions: number;
	instruction: string | null;
	chunkDuration: number;
	chunkOverlap: number;
	downscaleFps: number;
}) {
	const [values, setValues] = useState({
		name: initial?.name ?? "",
		baseUrl: initial?.baseUrl ?? "",
		apiKey: initial?.apiKey ?? "",
		model: initial?.model ?? "",
		dimensions: initial?.dimensions ?? 768,
		instruction: initial?.instruction ?? "",
		chunkDuration: initial?.chunkDuration ?? 30,
		chunkOverlap: initial?.chunkOverlap ?? 5,
		downscaleFps: initial?.downscaleFps ?? 5,
	});

	const onChange = (field: string, value: string | number) => {
		setValues((prev) => ({ ...prev, [field]: value }));
	};

	const canSubmit =
		values.name.trim() !== "" &&
		values.baseUrl.trim() !== "" &&
		values.model.trim() !== "";

	return { values, onChange, canSubmit };
}

function AddEmbedderDialog({ libraryId }: { libraryId: string }) {
	const [open, setOpen] = useState(false);
	const { values, onChange, canSubmit } = useEmbedderFormState();

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.embedder.create.mutate({
				libraryId,
				name: values.name,
				baseUrl: values.baseUrl,
				apiKey: values.apiKey || undefined,
				model: values.model,
				dimensions: values.dimensions,
				instruction: values.instruction || undefined,
				isDefault: true,
				chunkDuration: values.chunkDuration,
				chunkOverlap: values.chunkOverlap,
				downscaleFps: values.downscaleFps,
			}),
		onSuccess: () => {
			toast.success("Embedder added");
			queryClient.invalidateQueries({ queryKey: [["embedder", "list"]] });
			setOpen(false);
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const testMutation = useMutation({
		mutationFn: () =>
			trpcClient.embedder.test.mutate({
				baseUrl: values.baseUrl,
				apiKey: values.apiKey,
				model: values.model,
				dimensions: values.dimensions,
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

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger
				render={
					<Button size="sm">
						<Plus className="size-4" />
						Add Embedder
					</Button>
				}
			/>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add Embedder</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						createMutation.mutate();
					}}
				>
					<FieldGroup>
						<EmbedderFormFields
							idPrefix="add-emb"
							onChange={onChange}
							values={values}
						/>
						<div className="flex gap-2">
							<Button
								disabled={!canSubmit || createMutation.isPending}
								type="submit"
							>
								{createMutation.isPending ? "Adding..." : "Add"}
							</Button>
							<Button
								disabled={
									!(values.baseUrl.trim() && values.model.trim()) ||
									testMutation.isPending
								}
								onClick={() => testMutation.mutate()}
								type="button"
								variant="outline"
							>
								{testMutation.isPending ? "Testing..." : "Test"}
							</Button>
						</div>
					</FieldGroup>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function EditEmbedderDialog({
	embedder,
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
}) {
	const [open, setOpen] = useState(false);
	const { values, onChange, canSubmit } = useEmbedderFormState(embedder);

	const updateMutation = useMutation({
		mutationFn: () =>
			trpcClient.embedder.update.mutate({
				id: embedder.id,
				name: values.name,
				baseUrl: values.baseUrl,
				apiKey: values.apiKey || undefined,
				model: values.model,
				dimensions: values.dimensions,
				instruction: values.instruction || undefined,
				chunkDuration: values.chunkDuration,
				chunkOverlap: values.chunkOverlap,
				downscaleFps: values.downscaleFps,
			}),
		onSuccess: () => {
			toast.success("Embedder updated");
			queryClient.invalidateQueries({ queryKey: [["embedder", "list"]] });
			setOpen(false);
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const testMutation = useMutation({
		mutationFn: () =>
			trpcClient.embedder.test.mutate({
				baseUrl: values.baseUrl,
				apiKey: values.apiKey,
				model: values.model,
				dimensions: values.dimensions,
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

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger
				render={
					<Button size="icon-sm" variant="ghost">
						<Pencil className="size-3.5" />
					</Button>
				}
			/>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Edit {embedder.name}</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						updateMutation.mutate();
					}}
				>
					<FieldGroup>
						<EmbedderFormFields
							idPrefix={`edit-${embedder.id}`}
							onChange={onChange}
							values={values}
						/>
						<div className="flex gap-2">
							<Button
								disabled={!canSubmit || updateMutation.isPending}
								type="submit"
							>
								{updateMutation.isPending ? "Saving..." : "Save"}
							</Button>
							<Button
								disabled={
									!(values.baseUrl.trim() && values.model.trim()) ||
									testMutation.isPending
								}
								onClick={() => testMutation.mutate()}
								type="button"
								variant="outline"
							>
								{testMutation.isPending ? "Testing..." : "Test"}
							</Button>
						</div>
					</FieldGroup>
				</form>
			</DialogContent>
		</Dialog>
	);
}

function DeleteEmbedderButton({
	embedder,
}: {
	embedder: { id: string; name: string };
}) {
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

	return (
		<AlertDialog>
			<AlertDialogTrigger
				render={
					<Button
						disabled={deleteMutation.isPending}
						size="icon-sm"
						variant="ghost"
					>
						<Trash2 className="size-3.5" />
					</Button>
				}
			/>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>Delete {embedder.name}?</AlertDialogTitle>
					<AlertDialogDescription>
						This will remove the embedder, its chunks, and vector data. This
						cannot be undone.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>Cancel</AlertDialogCancel>
					<AlertDialogAction
						onClick={() => deleteMutation.mutate()}
						variant="destructive"
					>
						Delete
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function EmbedderCard({
	embedder,
	libraryId,
	onJobStarted,
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
	onJobStarted?: (jobId: string) => void;
}) {
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
		onSuccess: (data) => {
			toast.success(`Indexing started with ${embedder.name}`);
			onJobStarted?.(data.jobId);
			queryClient.invalidateQueries({ queryKey: [["job", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	return (
		<div className="flex items-center justify-between rounded-md border p-3">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<p className="font-medium text-sm">{embedder.name}</p>
					{embedder.isDefault && <Badge variant="secondary">default</Badge>}
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
					variant="outline"
				>
					Index
				</Button>
				<EditEmbedderDialog embedder={embedder} />
				{!embedder.isDefault && (
					<Button
						disabled={setDefaultMutation.isPending}
						onClick={() => setDefaultMutation.mutate()}
						size="xs"
						variant="ghost"
					>
						Set Default
					</Button>
				)}
				<DeleteEmbedderButton embedder={embedder} />
			</div>
		</div>
	);
}

function EmbeddersTab({
	libraryId,
	onJobStarted,
}: {
	libraryId: string;
	onJobStarted?: (jobId: string) => void;
}) {
	const embeddersQuery = useQuery(
		trpc.embedder.list.queryOptions({ libraryId })
	);

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h2 className="font-medium text-sm">Embedders</h2>
				<AddEmbedderDialog libraryId={libraryId} />
			</div>
			{embeddersQuery.data?.map((emb) => (
				<EmbedderCard
					embedder={emb}
					key={emb.id}
					libraryId={libraryId}
					onJobStarted={onJobStarted}
				/>
			))}
			{embeddersQuery.data?.length === 0 && (
				<p className="text-muted-foreground text-sm">
					No embedders configured. Add one to start indexing.
				</p>
			)}
		</div>
	);
}

// --- Search Tab ---

function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

interface SearchResult {
	chunkId: string;
	distance: number;
	endTime: number;
	fileName: string;
	filePath: string;
	libraryId: string;
	score: number;
	startTime: number;
	videoId: string;
}

function VideoPlayer({
	filePath,
	startTime,
}: {
	filePath: string;
	startTime: number;
}) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const serverUrl = import.meta.env.VITE_SERVER_URL as string;
	const src = `${serverUrl}/api/video?path=${encodeURIComponent(filePath)}#t=${startTime}`;

	return (
		<video
			className="w-full rounded-md"
			controls
			muted
			preload="metadata"
			ref={videoRef}
			src={src}
		/>
	);
}

function SearchResultCard({ result }: { result: SearchResult }) {
	const [showPlayer, setShowPlayer] = useState(false);

	return (
		<div className="rounded-md border p-3">
			<div className="flex items-center justify-between">
				<div className="min-w-0 flex-1">
					<p className="truncate font-medium text-sm">{result.fileName}</p>
					<p className="text-muted-foreground text-xs">
						{formatTime(result.startTime)} – {formatTime(result.endTime)}
					</p>
				</div>
				<div className="ml-2 flex items-center gap-2">
					<Badge variant="secondary">{(result.score * 100).toFixed(1)}%</Badge>
					<Button
						onClick={() => setShowPlayer(!showPlayer)}
						size="xs"
						variant="outline"
					>
						{showPlayer ? "Hide" : "Play"}
					</Button>
				</div>
			</div>
			<p className="mt-1 font-mono text-[10px] text-muted-foreground">
				chunk: {result.chunkId} | distance: {result.distance.toFixed(4)}
			</p>
			{showPlayer && (
				<div className="mt-2">
					<VideoPlayer
						filePath={result.filePath}
						startTime={result.startTime}
					/>
				</div>
			)}
		</div>
	);
}

function SearchTab({ libraryId }: { libraryId: string }) {
	const [searchQuery, setSearchQuery] = useQueryState(
		"q",
		parseAsString.withDefault("")
	);
	const [embedderId, setEmbedderId] = useQueryState(
		"embedder",
		parseAsString.withDefault("")
	);
	const [inputValue, setInputValue] = useState(searchQuery);

	const embeddersQuery = useQuery(
		trpc.embedder.list.queryOptions({ libraryId })
	);

	const defaultEmbedder = embeddersQuery.data?.find((e) => e.isDefault);
	const selectedEmbedderId = embedderId || defaultEmbedder?.id || "";

	const searchResults = useQuery({
		...trpc.search.query.queryOptions({
			query: searchQuery,
			libraryId,
			embedderId: selectedEmbedderId || undefined,
			limit: 20,
		}),
		enabled: searchQuery.length > 0 && selectedEmbedderId.length > 0,
	});

	const handleSearch = (e: React.FormEvent) => {
		e.preventDefault();
		setSearchQuery(inputValue.trim() || null);
	};

	return (
		<div className="space-y-4">
			<form className="flex flex-col gap-3" onSubmit={handleSearch}>
				<div className="flex gap-2">
					<Input
						autoComplete="off"
						className="flex-1"
						onChange={(e) => setInputValue(e.target.value)}
						placeholder="Describe what you're looking for..."
						value={inputValue}
					/>
					<Button
						disabled={
							!(inputValue.trim() && selectedEmbedderId) ||
							searchResults.isFetching
						}
						type="submit"
					>
						<Search className="size-4" />
						{searchResults.isFetching ? "Searching..." : "Search"}
					</Button>
				</div>
				{embeddersQuery.data && embeddersQuery.data.length > 0 && (
					<NativeSelect
						onChange={(e) => setEmbedderId(e.target.value || null)}
						value={selectedEmbedderId}
					>
						{embeddersQuery.data.map((emb) => (
							<NativeSelectOption key={emb.id} value={emb.id}>
								{emb.name} ({emb.model}, {emb.dimensions}d)
								{emb.isDefault ? " — default" : ""}
							</NativeSelectOption>
						))}
					</NativeSelect>
				)}
			</form>

			{searchResults.data?.debug && (
				<p className="font-mono text-muted-foreground text-xs">
					{searchResults.data.results.length} results from{" "}
					{searchResults.data.debug.totalVectors} vectors (
					{searchResults.data.debug.dimensions}d) | embed:{" "}
					{searchResults.data.debug.embedMs}ms | search:{" "}
					{searchResults.data.debug.searchMs}ms | embedder:{" "}
					{searchResults.data.debug.embedderName}
				</p>
			)}

			{searchResults.data && searchResults.data.results.length > 0 && (
				<div className="space-y-3">
					{searchResults.data.results.map((result) => (
						<SearchResultCard key={result.chunkId} result={result} />
					))}
				</div>
			)}

			{searchResults.data?.results.length === 0 && (
				<p className="text-muted-foreground text-sm">
					No results found. Try a different query.
				</p>
			)}

			{searchResults.error && (
				<p className="text-destructive text-sm">
					{searchResults.error.message}
				</p>
			)}
		</div>
	);
}

// --- Main Page ---

function LibraryDetailPage() {
	const { libraryId } = Route.useParams();
	const navigate = useNavigate();
	const [tab, setTab] = useQueryState(
		"tab",
		parseAsString.withDefault("videos")
	);

	const libraryQuery = useQuery(
		trpc.library.get.queryOptions({ id: libraryId })
	);
	const [trackedJobIds, setTrackedJobIds] = useState<string[]>([]);

	const jobsQuery = useQuery({
		...trpc.job.list.queryOptions({ libraryId, limit: 10 }),
		refetchInterval: (query) => {
			const jobs = query.state.data;
			const hasActive = jobs?.some(
				(j) => j.status === "pending" || j.status === "running"
			);
			return hasActive ? 3000 : false;
		},
	});

	const trackJob = (jobId: string) => {
		setTrackedJobIds((prev) =>
			prev.includes(jobId) ? prev : [...prev, jobId]
		);
		queryClient.invalidateQueries({ queryKey: [["job", "list"]] });
	};

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

	const activeJobs =
		jobsQuery.data?.filter(
			(j) => j.status === "pending" || j.status === "running"
		) ?? [];

	const activeJobIds = new Set(activeJobs.map((j) => j.id));
	const allJobIds = [
		...activeJobs.map((j) => j.id),
		...trackedJobIds.filter((id) => !activeJobIds.has(id)),
	];

	return (
		<div className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-bold text-2xl">{library.name}</h1>
					<p className="text-muted-foreground text-sm">{library.folderPath}</p>
				</div>
				<AlertDialog>
					<AlertDialogTrigger
						render={
							<Button
								disabled={deleteMutation.isPending}
								size="sm"
								variant="destructive"
							>
								<Trash2 className="size-4" />
								Delete
							</Button>
						}
					/>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>Delete {library.name}?</AlertDialogTitle>
							<AlertDialogDescription>
								This will permanently delete the library, all videos, embedders,
								and vector data.
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>Cancel</AlertDialogCancel>
							<AlertDialogAction
								onClick={() => deleteMutation.mutate()}
								variant="destructive"
							>
								Delete
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</div>

			{allJobIds.length > 0 && (
				<div className="space-y-2">
					{allJobIds.map((jobId) => (
						<IndexingProgress jobId={jobId} key={jobId} />
					))}
				</div>
			)}

			<Tabs onValueChange={(v) => setTab(v)} value={tab}>
				<TabsList>
					<TabsTrigger value="videos">Videos</TabsTrigger>
					<TabsTrigger value="embedders">Embedders</TabsTrigger>
					<TabsTrigger value="search">Search</TabsTrigger>
				</TabsList>
				<Separator className="my-4" />
				<TabsContent value="videos">
					<VideosTab
						libraryId={libraryId}
						onJobStarted={trackJob}
						videoCount={library.videoCount}
					/>
				</TabsContent>
				<TabsContent value="embedders">
					<EmbeddersTab libraryId={libraryId} onJobStarted={trackJob} />
				</TabsContent>
				<TabsContent value="search">
					<SearchTab libraryId={libraryId} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
