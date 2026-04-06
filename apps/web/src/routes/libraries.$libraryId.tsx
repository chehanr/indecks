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
import { Button } from "@indecks/ui/components/button";
import { Card, CardContent } from "@indecks/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@indecks/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@indecks/ui/components/field";
import { Input } from "@indecks/ui/components/input";
import {
	Progress,
	ProgressLabel,
	ProgressValue,
} from "@indecks/ui/components/progress";
import { Separator } from "@indecks/ui/components/separator";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { queryClient, trpc, trpcClient } from "@/utils/trpc";

export const Route = createFileRoute("/libraries/$libraryId")({
	component: LibraryLayout,
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data) {
			redirect({ to: "/login", throw: true });
		}
	},
});

// --- Job Tracking Context ---

interface JobTrackingContextValue {
	trackedJobIds: string[];
	trackJob: (jobId: string) => void;
}

const JobTrackingContext = createContext<JobTrackingContextValue>({
	trackedJobIds: [],
	trackJob: () => undefined,
});

export function useJobTracking() {
	return useContext(JobTrackingContext);
}

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

// --- Layout ---

const navLinks = [
	{ to: "/libraries/$libraryId/videos", label: "Videos" },
	{ to: "/libraries/$libraryId/settings", label: "Settings" },
	{ to: "/libraries/$libraryId/search", label: "Search" },
] as const;

function LibraryLayout() {
	const { libraryId } = Route.useParams();
	const navigate = useNavigate();

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
			<div className="container mx-auto max-w-[1800px] px-4 py-6">
				<p className="text-muted-foreground">Loading...</p>
			</div>
		);
	}
	if (!library) {
		return (
			<div className="container mx-auto max-w-[1800px] px-4 py-6">
				<p className="text-destructive">Library not found</p>
			</div>
		);
	}

	return (
		<JobTrackingContext value={{ trackedJobIds, trackJob }}>
			<div className="container mx-auto max-w-[1800px] space-y-6 px-4 py-6">
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

				<div>
					<nav className="flex items-center gap-4 text-sm">
						{navLinks.map(({ to, label }) => (
							<Link
								activeProps={{ className: "text-foreground font-medium" }}
								className="text-muted-foreground hover:text-foreground"
								key={to}
								params={{ libraryId }}
								to={to}
							>
								{label}
							</Link>
						))}
					</nav>
					<Separator className="mt-2" />
				</div>

				<Outlet />
			</div>
		</JobTrackingContext>
	);
}
