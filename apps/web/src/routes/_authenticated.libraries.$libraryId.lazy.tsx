import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@indecks/ui/components/breadcrumb";
import { Separator } from "@indecks/ui/components/separator";
import { useQuery } from "@tanstack/react-query";
import { createLazyFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { BreadcrumbPortal } from "@/components/breadcrumb-slot";
import { JobProgress } from "@/components/job-progress";
import { LibraryContext } from "@/hooks/use-library";
import { trpc, trpcClient } from "@/utils/trpc";

export const Route = createLazyFileRoute(
	"/_authenticated/libraries/$libraryId"
)({
	component: LibraryLayout,
});

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
	const [trackedJobs, setTrackedJobs] = useState<
		{ id: string; initialMessage?: string | null }[]
	>([]);

	useEffect(() => {
		trpcClient.job.list.query({ libraryId }).then((jobs) => {
			const active = jobs
				.filter((j) => j.status === "pending" || j.status === "running")
				.map((j) => ({ id: j.id, initialMessage: j.progressMessage }));
			if (active.length > 0) {
				setTrackedJobs((prev) => {
					const existingIds = new Set(prev.map((j) => j.id));
					return [...prev, ...active.filter((j) => !existingIds.has(j.id))];
				});
			}
		});
	}, [libraryId]);

	const trackJob = useCallback((jobId: string, initialMessage?: string) => {
		setTrackedJobs((prev) =>
			prev.some((j) => j.id === jobId)
				? prev
				: [...prev, { id: jobId, initialMessage }]
		);
	}, []);

	const removeJob = useCallback((jobId: string) => {
		setTrackedJobs((prev) => prev.filter((j) => j.id !== jobId));
	}, []);

	const library = libraryQuery.data;

	if (libraryQuery.isLoading) {
		return <p className="text-muted-foreground">Loading...</p>;
	}
	if (!library) {
		return <p className="text-destructive">Library not found</p>;
	}

	return (
		<LibraryContext
			value={{ library, trackedJobIds: trackedJobs.map((j) => j.id), trackJob }}
		>
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

				{trackedJobs.length > 0 && (
					<div className="space-y-2">
						{trackedJobs.map((job) => (
							<JobProgress
								initialMessage={job.initialMessage}
								jobId={job.id}
								key={job.id}
								onDone={() => removeJob(job.id)}
							/>
						))}
					</div>
				)}

				<Outlet />
			</div>
		</LibraryContext>
	);
}
