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
import { useMutation } from "@tanstack/react-query";
import { MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { queryClient, trpcClient } from "@/utils/trpc";

// --- Indexer Form ---

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

// --- Add Indexer Dialog ---

export function AddIndexerDialog({ libraryId }: { libraryId: string }) {
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

// --- Edit Indexer Dialog ---

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

// --- Delete Indexer ---

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

// --- Indexer Card ---

export function IndexerCard({
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
	onJobStarted?: (jobId: string, initialMessage?: string) => void;
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
			onJobStarted?.(data.jobId, data.progressMessage);
			queryClient.invalidateQueries({ queryKey: [["job", "list"]] });
			queryClient.invalidateQueries({ queryKey: [["library", "get"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const missingThumbsMutation = useMutation({
		mutationFn: () =>
			trpcClient.library.generateMissingThumbnails.mutate({
				libraryId,
				indexerId: indexer.id,
			}),
		onSuccess: (data) => {
			toast.success("Generating missing thumbnails");
			onJobStarted?.(data.jobId, data.progressMessage);
			queryClient.invalidateQueries({ queryKey: [["job", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const isBusy = indexMutation.isPending || missingThumbsMutation.isPending;

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
					<DropdownMenuTrigger
						render={
							<Button disabled={isBusy} size="icon" variant="ghost">
								<MoreHorizontal className="size-4" />
							</Button>
						}
					/>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => indexMutation.mutate(false)}>
							Index unindexed
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => indexMutation.mutate(true)}>
							Force re-index all
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => missingThumbsMutation.mutate()}>
							Generate missing thumbnails
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
