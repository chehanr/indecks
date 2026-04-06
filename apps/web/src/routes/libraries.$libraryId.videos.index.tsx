import { Button } from "@indecks/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@indecks/ui/components/dialog";
import {
	NativeSelect,
	NativeSelectOption,
} from "@indecks/ui/components/native-select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, FolderSearch } from "lucide-react";
import { parseAsInteger, useQueryState } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";

import { useJobTracking } from "@/routes/libraries.$libraryId";
import { queryClient, trpc, trpcClient } from "@/utils/trpc";

export const Route = createFileRoute("/libraries/$libraryId/videos/")({
	component: VideosPage,
});

// --- Index Video Dialog ---

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

// --- Video Row ---

function VideoRow({
	libraryId,
	video,
	indexers,
	onJobStarted,
}: {
	libraryId: string;
	video: {
		id: string;
		fileName: string;
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
				<Link
					className="block truncate font-medium text-sm hover:underline"
					params={{ libraryId, videoId: video.id }}
					to="/libraries/$libraryId/videos/$videoId"
				>
					{video.fileName}
				</Link>
				<div className="flex items-center gap-2">
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
			</div>
		</div>
	);
}

// --- Videos Page ---

const PAGE_SIZE_OPTIONS = [20, 40, 60, 100] as const;
const DEFAULT_PAGE_SIZE = 20;

function VideosPage() {
	const { libraryId } = Route.useParams();
	const { trackJob } = useJobTracking();

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

	const videosQuery = useQuery(
		trpc.library.videos.queryOptions({
			libraryId,
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
		<div className="space-y-4">
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
	);
}
