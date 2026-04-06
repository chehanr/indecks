import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@indecks/ui/components/breadcrumb";
import { Button } from "@indecks/ui/components/button";
import { Card, CardContent } from "@indecks/ui/components/card";
import {
	Progress,
	ProgressLabel,
	ProgressValue,
} from "@indecks/ui/components/progress";
import { Separator } from "@indecks/ui/components/separator";
import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { X } from "lucide-react";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";

import { BreadcrumbPortal } from "@/components/breadcrumb-slot";
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
		statusLabel = "Complete";
	} else if (state.status === "failed") {
		statusLabel = "Failed";
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

// --- Layout ---

const navLinks = [
	{ to: "/libraries/$libraryId", label: "Search" },
	{ to: "/libraries/$libraryId/videos", label: "Videos" },
	{ to: "/libraries/$libraryId/settings", label: "Settings" },
] as const;

function LibraryLayout() {
	const { libraryId } = Route.useParams();

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

	const library = libraryQuery.data;

	if (libraryQuery.isLoading) {
		return <p className="text-muted-foreground">Loading...</p>;
	}
	if (!library) {
		return <p className="text-destructive">Library not found</p>;
	}

	return (
		<JobTrackingContext value={{ trackedJobIds, trackJob }}>
			<BreadcrumbPortal>
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbLink render={<Link to="/libraries" />}>
								Libraries
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{library.name}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			</BreadcrumbPortal>

			<div className="space-y-6">
				<div>
					<nav className="flex items-center gap-4 text-sm">
						{navLinks.map(({ to, label }) => (
							<Link
								activeOptions={{ exact: true }}
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

				<Outlet />
			</div>
		</JobTrackingContext>
	);
}
