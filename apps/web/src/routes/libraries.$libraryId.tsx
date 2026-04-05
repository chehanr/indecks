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
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@indecks/ui/components/dropdown-menu";
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
import { FolderSearch, Pencil, Plus, Trash2, X } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";

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

function IndexingProgress({
	jobId,
	onDone,
}: {
	jobId: string;
	onDone?: () => void;
}) {
	const [state, setState] = useState({
		status: "running",
		progress: 0,
		progressMessage: null as string | null,
		errorMessage: null as string | null,
	});

	useEffect(() => {
		const sub = trpcClient.job.onProgress.subscribe(
			{ jobId },
			{
				onData(event) {
					setState({
						status: event.status,
						progress: event.progress,
						progressMessage: event.progressMessage,
						errorMessage: event.errorMessage,
					});
					if (
						event.status === "completed" ||
						event.status === "failed" ||
						event.status === "cancelled"
					) {
						queryClient.invalidateQueries({
							queryKey: [["library", "videos"]],
						});
						queryClient.invalidateQueries({ queryKey: [["library", "get"]] });
						setTimeout(() => onDone?.(), 3000);
					}
				},
			}
		);
		return () => sub.unsubscribe();
	}, [jobId, onDone]);

	const isActive = state.status === "running" || state.status === "pending";

	const handleCancel = () => {
		trpcClient.job.cancel.mutate({ id: jobId }).then(() => {
			setState((prev) => ({ ...prev, status: "cancelled" }));
			queryClient.invalidateQueries({ queryKey: [["library", "videos"]] });
			queryClient.invalidateQueries({ queryKey: [["library", "get"]] });
			setTimeout(() => onDone?.(), 3000);
		});
	};

	let statusLabel = state.progressMessage ?? "Starting...";
	if (state.status === "completed") {
		statusLabel = "Indexing complete";
	} else if (state.status === "failed") {
		statusLabel = "Indexing failed";
	} else if (state.status === "cancelled") {
		statusLabel = "Cancelled";
	}

	return (
		<Card>
			<CardContent className="py-4">
				<div className="flex items-center gap-2">
					<div className="flex-1">
						<Progress value={state.progress === -1 ? null : state.progress}>
							<ProgressLabel>{statusLabel}</ProgressLabel>
							{state.progress !== -1 && <ProgressValue />}
						</Progress>
					</div>
					{isActive && (
						<Button
							className="h-6 w-6 shrink-0"
							onClick={handleCancel}
							size="icon"
							variant="ghost"
						>
							<X className="h-4 w-4" />
						</Button>
					)}
				</div>
				{state.errorMessage && (
					<p className="mt-2 text-destructive text-xs">{state.errorMessage}</p>
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
	indexers,
	onJobStarted,
}: {
	videoId: string;
	indexers: {
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
				indexerId: selectedId,
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
			const def = indexers.find((e) => e.isDefault);
			setSelectedId(def?.id ?? indexers[0]?.id ?? "");
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
						{indexers.map((emb) => (
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
	indexers,
	onJobStarted,
}: {
	video: {
		id: string;
		fileName: string;
		duration: number | null;
		status: string;
		indexedBy: string[];
	};
	indexers: {
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
				{indexers.length > 0 && (
					<IndexVideoDialog
						indexers={indexers}
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
	const indexersQuery = useQuery(trpc.indexer.list.queryOptions({ libraryId }));
	const indexers = (indexersQuery.data ?? []).map((e) => ({
		id: e.id,
		name: e.name,
		model: e.model,
		dimensions: e.dimensions,
		isDefault: e.isDefault,
	}));

	const scanMutation = useMutation({
		mutationFn: () => trpcClient.library.startScan.mutate({ id: libraryId }),
		onSuccess: (data) => {
			toast.success("Scan started");
			onJobStarted?.(data.jobId);
			queryClient.invalidateQueries({ queryKey: [["job", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h2 className="font-medium text-sm">{videoCount} videos</h2>
				<Button
					disabled={scanMutation.isPending}
					onClick={() => scanMutation.mutate()}
					size="sm"
					variant="outline"
				>
					<FolderSearch className="size-4" />
					{scanMutation.isPending ? "Scanning..." : "Scan"}
				</Button>
			</div>
			{videosQuery.isLoading && (
				<p className="text-muted-foreground text-sm">Loading videos...</p>
			)}
			{videosQuery.data?.length === 0 && (
				<p className="text-muted-foreground text-sm">
					No videos found. Add an indexer and start indexing.
				</p>
			)}
			{videosQuery.data && videosQuery.data.length > 0 && (
				<div className="divide-y">
					{videosQuery.data.map((video) => (
						<VideoRow
							indexers={indexers}
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

// --- Indexers Tab ---

function IndexerFormFields({
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
		indexConcurrency: number;
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
						onChange("downscaleFps", Number.parseInt(e.target.value, 10) || 1)
					}
					type="number"
					value={values.downscaleFps}
				/>
			</Field>
			<Field>
				<FieldLabel htmlFor={`${idPrefix}-indexConcurrency`}>
					Index Concurrency
				</FieldLabel>
				<Input
					id={`${idPrefix}-indexConcurrency`}
					max={16}
					min={1}
					onChange={(e) =>
						onChange(
							"indexConcurrency",
							Number.parseInt(e.target.value, 10) || 3
						)
					}
					type="number"
					value={values.indexConcurrency}
				/>
			</Field>
		</>
	);
}

function useIndexerFormState(initial?: {
	name: string;
	baseUrl: string;
	apiKey: string | null;
	model: string;
	dimensions: number;
	instruction: string | null;
	chunkDuration: number;
	chunkOverlap: number;
	downscaleFps: number;
	indexConcurrency: number;
}) {
	const [values, setValues] = useState({
		name: initial?.name ?? "",
		baseUrl: initial?.baseUrl ?? "",
		apiKey: initial?.apiKey ?? "",
		model: initial?.model ?? "",
		dimensions: initial?.dimensions ?? 768,
		instruction: initial?.instruction ?? "",
		chunkDuration: initial?.chunkDuration ?? 30,
		chunkOverlap: initial?.chunkOverlap ?? 0,
		downscaleFps: initial?.downscaleFps ?? 1,
		indexConcurrency: initial?.indexConcurrency ?? 3,
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

function AddIndexerDialog({ libraryId }: { libraryId: string }) {
	const [open, setOpen] = useState(false);
	const { values, onChange, canSubmit } = useIndexerFormState();

	const createMutation = useMutation({
		mutationFn: () =>
			trpcClient.indexer.create.mutate({
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
				indexConcurrency: values.indexConcurrency,
			}),
		onSuccess: () => {
			toast.success("Indexer added");
			queryClient.invalidateQueries({ queryKey: [["indexer", "list"]] });
			setOpen(false);
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const testMutation = useMutation({
		mutationFn: () =>
			trpcClient.indexer.test.mutate({
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
						Add Indexer
					</Button>
				}
			/>
			<DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Add Indexer</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						createMutation.mutate();
					}}
				>
					<FieldGroup>
						<IndexerFormFields
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

function EditIndexerDialog({
	indexer,
}: {
	indexer: {
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
		indexConcurrency: number;
	};
}) {
	const [open, setOpen] = useState(false);
	const { values, onChange, canSubmit } = useIndexerFormState(indexer);

	const updateMutation = useMutation({
		mutationFn: () =>
			trpcClient.indexer.update.mutate({
				id: indexer.id,
				name: values.name,
				baseUrl: values.baseUrl,
				apiKey: values.apiKey || undefined,
				model: values.model,
				dimensions: values.dimensions,
				instruction: values.instruction || undefined,
				chunkDuration: values.chunkDuration,
				chunkOverlap: values.chunkOverlap,
				downscaleFps: values.downscaleFps,
				indexConcurrency: values.indexConcurrency,
			}),
		onSuccess: () => {
			toast.success("Indexer updated");
			queryClient.invalidateQueries({ queryKey: [["indexer", "list"]] });
			setOpen(false);
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const testMutation = useMutation({
		mutationFn: () =>
			trpcClient.indexer.test.mutate({
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
					<DialogTitle>Edit {indexer.name}</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						updateMutation.mutate();
					}}
				>
					<FieldGroup>
						<IndexerFormFields
							idPrefix={`edit-${indexer.id}`}
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

function DeleteIndexerButton({
	indexer,
}: {
	indexer: { id: string; name: string };
}) {
	const deleteMutation = useMutation({
		mutationFn: () => trpcClient.indexer.delete.mutate({ id: indexer.id }),
		onSuccess: () => {
			toast.success(`Deleted ${indexer.name}`);
			queryClient.invalidateQueries({ queryKey: [["indexer", "list"]] });
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
					<AlertDialogTitle>Delete {indexer.name}?</AlertDialogTitle>
					<AlertDialogDescription>
						This will remove the indexer, its chunks, and vector data. This
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

function IndexerCard({
	indexer,
	libraryId,
	onJobStarted,
}: {
	indexer: {
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
		indexConcurrency: number;
	};
	libraryId: string;
	onJobStarted?: (jobId: string) => void;
}) {
	const setDefaultMutation = useMutation({
		mutationFn: () =>
			trpcClient.indexer.update.mutate({ id: indexer.id, isDefault: true }),
		onSuccess: () => {
			toast.success(`${indexer.name} set as default`);
			queryClient.invalidateQueries({ queryKey: [["indexer", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const indexMutation = useMutation({
		mutationFn: (force?: boolean) =>
			trpcClient.library.startIndexing.mutate({
				id: libraryId,
				indexerId: indexer.id,
				force,
			}),
		onSuccess: (data) => {
			toast.success(`Indexing started with ${indexer.name}`);
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
					<p className="font-medium text-sm">{indexer.name}</p>
					{indexer.isDefault && <Badge variant="secondary">default</Badge>}
				</div>
				<p className="text-muted-foreground text-xs">
					{indexer.model} ({indexer.dimensions}d) | chunk:{" "}
					{indexer.chunkDuration}s, overlap: {indexer.chunkOverlap}s, fps:{" "}
					{indexer.downscaleFps}, concurrency: {indexer.indexConcurrency}
				</p>
				<p className="truncate text-muted-foreground text-xs">
					{indexer.baseUrl}
				</p>
			</div>
			<div className="ml-2 flex items-center gap-1">
				<DropdownMenu>
					<DropdownMenuTrigger>
						<Button
							disabled={indexMutation.isPending}
							size="sm"
							variant="outline"
						>
							Index
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => indexMutation.mutate(false)}>
							Index unindexed
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => indexMutation.mutate(true)}>
							Force re-index all
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				<EditIndexerDialog indexer={indexer} />
				{!indexer.isDefault && (
					<Button
						disabled={setDefaultMutation.isPending}
						onClick={() => setDefaultMutation.mutate()}
						size="xs"
						variant="ghost"
					>
						Set Default
					</Button>
				)}
				<DeleteIndexerButton indexer={indexer} />
			</div>
		</div>
	);
}

function IndexersTab({
	libraryId,
	onJobStarted,
}: {
	libraryId: string;
	onJobStarted?: (jobId: string) => void;
}) {
	const indexersQuery = useQuery(trpc.indexer.list.queryOptions({ libraryId }));

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h2 className="font-medium text-sm">Indexers</h2>
				<AddIndexerDialog libraryId={libraryId} />
			</div>
			{indexersQuery.data?.map((emb) => (
				<IndexerCard
					indexer={emb}
					key={emb.id}
					libraryId={libraryId}
					onJobStarted={onJobStarted}
				/>
			))}
			{indexersQuery.data?.length === 0 && (
				<p className="text-muted-foreground text-sm">
					No indexers configured. Add one to start indexing.
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
		parseAsString.withDefault("").withOptions({ history: "replace" })
	);
	const [indexerId, setIndexerId] = useQueryState(
		"indexer",
		parseAsString.withDefault("").withOptions({ history: "replace" })
	);
	const [inputValue, setInputValue] = useState(searchQuery);

	const indexersQuery = useQuery(trpc.indexer.list.queryOptions({ libraryId }));

	const defaultIndexer = indexersQuery.data?.find((e) => e.isDefault);
	const selectedIndexerId = indexerId || defaultIndexer?.id || "";

	const debouncedSearch = useDebouncedCallback((value: string) => {
		setSearchQuery(value.trim() || null);
	}, 400);

	const handleInputChange = (value: string) => {
		setInputValue(value);
		debouncedSearch(value);
	};

	const searchResults = useQuery({
		...trpc.search.query.queryOptions({
			query: searchQuery,
			libraryId,
			indexerId: selectedIndexerId || undefined,
			limit: 20,
		}),
		enabled: searchQuery.length > 0 && selectedIndexerId.length > 0,
	});

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3">
				<Input
					autoComplete="off"
					onChange={(e) => handleInputChange(e.target.value)}
					placeholder="Describe what you're looking for..."
					value={inputValue}
				/>
				{indexersQuery.data && indexersQuery.data.length > 0 && (
					<NativeSelect
						onChange={(e) => setIndexerId(e.target.value || null)}
						value={selectedIndexerId}
					>
						{indexersQuery.data.map((emb) => (
							<NativeSelectOption key={emb.id} value={emb.id}>
								{emb.name} ({emb.model}, {emb.dimensions}d)
								{emb.isDefault ? " — default" : ""}
							</NativeSelectOption>
						))}
					</NativeSelect>
				)}
			</div>

			{searchResults.data?.debug && (
				<p className="font-mono text-muted-foreground text-xs">
					{searchResults.data.results.length} results from{" "}
					{searchResults.data.debug.totalVectors} vectors (
					{searchResults.data.debug.dimensions}d) | embed:{" "}
					{searchResults.data.debug.embedMs}ms | search:{" "}
					{searchResults.data.debug.searchMs}ms | indexer:{" "}
					{searchResults.data.debug.indexerName}
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

// --- Edit Library Dialog ---

function EditLibraryDialog({
	library,
}: {
	library: {
		id: string;
		name: string;
		folderPaths: string;
		scanConcurrency: number;
	};
}) {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState(library.name);
	const [folderPaths, setFolderPaths] = useState<string[]>(() =>
		JSON.parse(library.folderPaths)
	);
	const [scanConcurrency, setScanConcurrency] = useState(
		library.scanConcurrency
	);

	const handleOpen = (next: boolean) => {
		setOpen(next);
		if (next) {
			setName(library.name);
			setFolderPaths(JSON.parse(library.folderPaths));
			setScanConcurrency(library.scanConcurrency);
		}
	};

	const updateMutation = useMutation({
		mutationFn: () =>
			trpcClient.library.update.mutate({
				id: library.id,
				name,
				folderPaths: folderPaths.filter((p) => p.trim()),
				scanConcurrency,
			}),
		onSuccess: () => {
			toast.success("Library updated");
			queryClient.invalidateQueries({ queryKey: [["library", "get"]] });
			queryClient.invalidateQueries({ queryKey: [["library", "list"]] });
			setOpen(false);
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const validPaths = folderPaths.filter((p) => p.trim());
	const canSubmit = name.trim() !== "" && validPaths.length > 0;

	return (
		<Dialog onOpenChange={handleOpen} open={open}>
			<DialogTrigger
				render={
					<Button size="sm" variant="outline">
						<Pencil className="size-4" />
						Edit
					</Button>
				}
			/>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Edit Library</DialogTitle>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (canSubmit) {
							updateMutation.mutate();
						}
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="edit-lib-name">Name</FieldLabel>
							<Input
								id="edit-lib-name"
								onChange={(e) => setName(e.target.value)}
								value={name}
							/>
						</Field>
						<Field>
							<FieldLabel>Folder Paths</FieldLabel>
							<div className="space-y-2">
								{folderPaths.map((path, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: editable input list
									<div className="flex gap-2" key={i}>
										<Input
											onChange={(e) => {
												const next = [...folderPaths];
												next[i] = e.target.value;
												setFolderPaths(next);
											}}
											placeholder="/path/to/videos"
											value={path}
										/>
										{folderPaths.length > 1 && (
											<Button
												onClick={() =>
													setFolderPaths(folderPaths.filter((_, j) => j !== i))
												}
												size="icon"
												type="button"
												variant="ghost"
											>
												<Trash2 className="size-4" />
											</Button>
										)}
									</div>
								))}
								<Button
									onClick={() => setFolderPaths([...folderPaths, ""])}
									size="sm"
									type="button"
									variant="outline"
								>
									<Plus className="size-4" />
									Add Path
								</Button>
							</div>
						</Field>
						<Field>
							<FieldLabel htmlFor="edit-lib-scanConcurrency">
								Scan Concurrency
							</FieldLabel>
							<Input
								id="edit-lib-scanConcurrency"
								max={16}
								min={1}
								onChange={(e) =>
									setScanConcurrency(Number.parseInt(e.target.value, 10) || 3)
								}
								type="number"
								value={scanConcurrency}
							/>
						</Field>
						<Button
							disabled={!canSubmit || updateMutation.isPending}
							type="submit"
						>
							{updateMutation.isPending ? "Saving..." : "Save"}
						</Button>
					</FieldGroup>
				</form>
			</DialogContent>
		</Dialog>
	);
}

// --- Main Page ---

function LibraryDetailPage() {
	const { libraryId } = Route.useParams();
	const navigate = useNavigate();
	const [tab, setTab] = useQueryState(
		"tab",
		parseAsString.withDefault("videos").withOptions({ history: "replace" })
	);

	const libraryQuery = useQuery(
		trpc.library.get.queryOptions({ id: libraryId })
	);
	const [trackedJobIds, setTrackedJobIds] = useState<string[]>([]);

	useEffect(() => {
		trpcClient.job.list.query({ libraryId }).then((jobs) => {
			const activeIds = jobs
				.filter((j) => j.status === "pending" || j.status === "running")
				.map((j) => j.id);
			if (activeIds.length > 0) {
				setTrackedJobIds((prev) => [
					...prev,
					...activeIds.filter((id) => !prev.includes(id)),
				]);
			}
		});
	}, [libraryId]);

	const trackJob = useCallback((jobId: string) => {
		setTrackedJobIds((prev) =>
			prev.includes(jobId) ? prev : [...prev, jobId]
		);
	}, []);

	const removeJob = useCallback((jobId: string) => {
		setTrackedJobIds((prev) => prev.filter((id) => id !== jobId));
	}, []);

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

	return (
		<div className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="font-bold text-2xl">{library.name}</h1>
					{(() => {
						const paths: string[] = JSON.parse(library.folderPaths);
						return paths.map((p) => (
							<p className="text-muted-foreground text-sm" key={p}>
								{p}
							</p>
						));
					})()}
				</div>
				<div className="flex items-center gap-2">
					<EditLibraryDialog library={library} />
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
									This will permanently delete the library, all videos,
									indexers, and vector data.
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
			</div>

			{trackedJobIds.length > 0 && (
				<div className="space-y-2">
					{trackedJobIds.map((jobId) => (
						<IndexingProgress
							jobId={jobId}
							key={jobId}
							onDone={() => removeJob(jobId)}
						/>
					))}
				</div>
			)}

			<Tabs onValueChange={(v) => setTab(v)} value={tab}>
				<TabsList>
					<TabsTrigger value="videos">Videos</TabsTrigger>
					<TabsTrigger value="indexers">Indexers</TabsTrigger>
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
				<TabsContent value="indexers">
					<IndexersTab libraryId={libraryId} onJobStarted={trackJob} />
				</TabsContent>
				<TabsContent value="search">
					<SearchTab libraryId={libraryId} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
