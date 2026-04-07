import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@indecks/ui/components/breadcrumb";
import { Button } from "@indecks/ui/components/button";
import { Input } from "@indecks/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@indecks/ui/components/native-select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, FolderSearch, Search } from "lucide-react";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";
import { useDebouncedCallback } from "use-debounce";

import { BreadcrumbPortal } from "@/components/breadcrumb-slot";
import { VideoRow } from "@/components/video-row";
import { useJobTracking, useLibrary } from "@/hooks/use-library";
import { queryClient, trpc, trpcClient } from "@/utils/trpc";

export const Route = createLazyFileRoute(
	"/_authenticated/libraries/$libraryId/videos/"
)({
	component: VideosPage,
});

const PAGE_SIZE_OPTIONS = [20, 40, 60, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

function VideosPage() {
	const { libraryId } = Route.useParams();
	const library = useLibrary();
	const { trackJob } = useJobTracking();

	const [searchQuery, setSearchQuery] = useQueryState(
		"q",
		parseAsString.withDefault("")
	);
	const [inputValue, setInputValue] = useState(searchQuery);
	const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
	const [pageSize, setPageSize] = useQueryState(
		"size",
		parseAsInteger.withDefault(DEFAULT_PAGE_SIZE)
	);

	const effectivePageSize = PAGE_SIZE_OPTIONS.includes(
		pageSize as (typeof PAGE_SIZE_OPTIONS)[number]
	)
		? pageSize
		: DEFAULT_PAGE_SIZE;

	const offset = (page - 1) * effectivePageSize;

	const debouncedSearch = useDebouncedCallback((value: string) => {
		setSearchQuery(value.trim() || null);
		setPage(null);
	}, 400);

	const handleInputChange = (value: string) => {
		setInputValue(value);
		debouncedSearch(value);
	};

	const videosQuery = useQuery(
		trpc.library.videos.queryOptions({
			libraryId,
			search: searchQuery || undefined,
			limit: effectivePageSize,
			offset,
		})
	);
	const indexersQuery = useQuery(trpc.indexer.list.queryOptions({ libraryId }));
	const indexers = (indexersQuery.data ?? []).map((e) => ({
		id: e.id,
		name: e.name,
		model: e.model,
		dimensions: e.dimensions,
		isDefault: e.isDefault,
	}));

	const total = videosQuery.data?.total ?? 0;
	const totalPages = Math.max(1, Math.ceil(total / effectivePageSize));
	const videos = videosQuery.data?.items ?? [];

	const scanMutation = useMutation({
		mutationFn: () => trpcClient.library.startScan.mutate({ id: libraryId }),
		onSuccess: (data) => {
			toast.success("Scan started");
			trackJob(data.jobId);
			queryClient.invalidateQueries({ queryKey: [["job", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const handlePageSizeChange = (size: number) => {
		setPageSize(size === DEFAULT_PAGE_SIZE ? null : size);
		setPage(null);
	};

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
							<BreadcrumbPage>Videos</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			</BreadcrumbPortal>

			<div className="space-y-4">
				<div className="flex items-center gap-3">
					<Search className="size-4 shrink-0 text-muted-foreground" />
					<Input
						autoComplete="off"
						className="flex-1"
						onChange={(e) => handleInputChange(e.target.value)}
						placeholder="Filter by file name..."
						value={inputValue}
					/>
				</div>

				<div className="flex flex-col gap-2 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
					<p className="font-mono text-muted-foreground text-xs">
						{total} results
					</p>
					<div className="flex items-center gap-2">
						<NativeSelect
							className="w-auto"
							onChange={(e) =>
								handlePageSizeChange(Number.parseInt(e.target.value, 10))
							}
							value={effectivePageSize}
						>
							{PAGE_SIZE_OPTIONS.map((size) => (
								<NativeSelectOption key={size} value={size}>
									{size} per page
								</NativeSelectOption>
							))}
						</NativeSelect>
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
				</div>

				{videosQuery.isLoading && (
					<p className="text-muted-foreground text-sm">Loading videos...</p>
				)}
				{videos.length === 0 && !videosQuery.isLoading && (
					<p className="text-muted-foreground text-sm">
						No videos found. Scan your library to discover videos.
					</p>
				)}
				{videos.length > 0 && (
					<div className="divide-y">
						{videos.map((video) => (
							<VideoRow
								indexers={indexers}
								key={video.id}
								libraryId={libraryId}
								onJobStarted={trackJob}
								video={video}
							/>
						))}
					</div>
				)}

				{totalPages > 1 && (
					<div className="flex items-center justify-between">
						<span className="text-muted-foreground text-sm">
							Page {page} of {totalPages}
						</span>
						<div className="flex items-center gap-1">
							<Button
								disabled={page <= 1}
								onClick={() => setPage(page - 1 <= 1 ? null : page - 1)}
								size="sm"
								variant="outline"
							>
								<ChevronLeft className="size-4" />
							</Button>
							<Button
								disabled={page >= totalPages}
								onClick={() => setPage(page + 1)}
								size="sm"
								variant="outline"
							>
								<ChevronRight className="size-4" />
							</Button>
						</div>
					</div>
				)}
			</div>
		</>
	);
}
