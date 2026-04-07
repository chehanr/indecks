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
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@indecks/ui/components/breadcrumb";
import { Button } from "@indecks/ui/components/button";
import { Separator } from "@indecks/ui/components/separator";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createLazyFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";

import { BreadcrumbPortal } from "@/components/breadcrumb-slot";
import { EditLibraryForm } from "@/components/edit-library-form";
import { AddIndexerDialog, IndexerCard } from "@/components/indexer-card";
import { useJobTracking, useLibrary } from "@/hooks/use-library";
import { trpc, trpcClient } from "@/utils/trpc";

export const Route = createLazyFileRoute(
	"/_authenticated/libraries/$libraryId/settings"
)({
	component: SettingsPage,
});

function SettingsPage() {
	const { libraryId } = Route.useParams();
	const navigate = useNavigate();
	const library = useLibrary();
	const { trackJob } = useJobTracking();

	const indexersQuery = useQuery(trpc.indexer.list.queryOptions({ libraryId }));

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

	return (
		<>
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
							<BreadcrumbLink
								render={
									<Link params={{ libraryId }} to="/libraries/$libraryId" />
								}
							>
								{library.name}
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>Settings</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			</BreadcrumbPortal>

			<div className="space-y-6">
				<div className="space-y-4">
					<h2 className="font-medium text-sm">Library</h2>
					{library && <EditLibraryForm library={library} />}
				</div>

				<Separator />

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
							onJobStarted={trackJob}
						/>
					))}
					{indexersQuery.data?.length === 0 && (
						<p className="text-muted-foreground text-sm">
							No indexers configured. Add one to start indexing.
						</p>
					)}
				</div>

				<Separator />

				<div className="space-y-4">
					<h2 className="font-medium text-sm">Danger Zone</h2>
					<AlertDialog>
						<AlertDialogTrigger
							render={
								<Button
									disabled={deleteMutation.isPending}
									size="sm"
									variant="destructive"
								>
									<Trash2 className="size-4" />
									Delete Library
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
		</>
	);
}
