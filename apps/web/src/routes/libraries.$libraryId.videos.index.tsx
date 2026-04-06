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
	NativeSelect,
	NativeSelectOption,
} from "@indecks/ui/components/native-select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { FolderSearch } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useJobTracking } from "@/routes/libraries.$libraryId";
import { queryClient, trpc, trpcClient } from "@/utils/trpc";

export const Route = createFileRoute("/libraries/$libraryId/videos/")({
	component: VideosPage,
});

// --- Video Status ---

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

// --- Videos Page ---

function VideosPage() {
	const { libraryId } = Route.useParams();
	const { trackJob } = useJobTracking();

	const libraryQuery = useQuery(
		trpc.library.get.queryOptions({ id: libraryId })
	);
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
			trackJob(data.jobId);
			queryClient.invalidateQueries({ queryKey: [["job", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h2 className="font-medium text-sm">
					{libraryQuery.data?.videoCount ?? 0} videos
				</h2>
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
							onJobStarted={trackJob}
							video={video}
						/>
					))}
				</div>
			)}
		</div>
	);
}
