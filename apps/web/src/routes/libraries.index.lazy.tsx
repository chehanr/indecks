import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbList,
	BreadcrumbPage,
} from "@indecks/ui/components/breadcrumb";
import { useQuery } from "@tanstack/react-query";
import { createLazyFileRoute } from "@tanstack/react-router";

import { BreadcrumbPortal } from "@/components/breadcrumb-slot";
import { CreateLibraryDialog } from "@/components/create-library-dialog";
import { LibraryCard } from "@/components/library-card";
import { trpc } from "@/utils/trpc";

export const Route = createLazyFileRoute("/libraries/")({
	component: LibrariesPage,
});

function LibrariesPage() {
	const librariesQuery = useQuery(trpc.library.list.queryOptions());

	return (
		<>
			<BreadcrumbPortal>
				<Breadcrumb>
					<BreadcrumbList>
						<BreadcrumbItem>
							<BreadcrumbPage>Libraries</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			</BreadcrumbPortal>

			<div className="space-y-6">
				<div className="flex items-center justify-end">
					<CreateLibraryDialog />
				</div>

				{librariesQuery.isLoading && (
					<p className="text-muted-foreground text-sm">Loading...</p>
				)}

				{librariesQuery.data && librariesQuery.data.length > 0 && (
					<div className="grid gap-4">
						{librariesQuery.data.map((lib) => (
							<LibraryCard key={lib.id} library={lib} />
						))}
					</div>
				)}

				{librariesQuery.data?.length === 0 && (
					<p className="text-muted-foreground text-sm">
						No libraries yet. Create one to get started.
					</p>
				)}
			</div>
		</>
	);
}
