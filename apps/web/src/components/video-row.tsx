import { Button } from "@indecks/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@indecks/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@indecks/ui/components/dropdown-menu";
import {
	NativeSelect,
	NativeSelectOption,
} from "@indecks/ui/components/native-select";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { queryClient, trpcClient } from "@/utils/trpc";

interface Indexer {
	dimensions: number;
	id: string;
	isDefault: boolean;
	model: string;
	name: string;
}

type DialogAction = "reindex" | "regenerate_thumbnails";

function ActionDialog({
	videoId,
	action,
	indexers,
	open,
	onOpenChange,
	onJobStarted,
}: {
	videoId: string;
	action: DialogAction;
	indexers: Indexer[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onJobStarted?: (jobId: string, initialMessage?: string) => void;
}) {
	const [selectedId, setSelectedId] = useState(
		() => indexers.find((e) => e.isDefault)?.id ?? indexers[0]?.id ?? ""
	);

	const reindexMutation = useMutation({
		mutationFn: () =>
			trpcClient.library.reindexVideo.mutate({
				videoId,
				indexerId: selectedId,
			}),
		onSuccess: (data) => {
			toast.success("Indexing started");
			onJobStarted?.(data.jobId, data.progressMessage);
			queryClient.invalidateQueries({ queryKey: [["job", "list"]] });
			queryClient.invalidateQueries({ queryKey: [["library", "videos"]] });
			onOpenChange(false);
		},
		onError: (err) => toast.error(err.message),
	});

	const regenMutation = useMutation({
		mutationFn: () =>
			trpcClient.library.regenerateThumbnails.mutate({
				videoId,
				indexerId: selectedId,
			}),
		onSuccess: (data) => {
			toast.success("Thumbnail regeneration started");
			onJobStarted?.(data.jobId, data.progressMessage);
			queryClient.invalidateQueries({ queryKey: [["job", "list"]] });
			onOpenChange(false);
		},
		onError: (err) => toast.error(err.message),
	});

	const isPending = reindexMutation.isPending || regenMutation.isPending;
	const isReindex = action === "reindex";
	const title = isReindex ? "Reindex Video" : "Regenerate Thumbnails";
	const buttonLabel = isReindex ? "Start Indexing" : "Regenerate";
	const handleSubmit = isReindex
		? () => reindexMutation.mutate()
		: () => regenMutation.mutate();

	return (
		<Dialog onOpenChange={onOpenChange} open={open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
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
					<Button disabled={!selectedId || isPending} onClick={handleSubmit}>
						{isPending ? "Starting..." : buttonLabel}
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function VideoRow({
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
	indexers: Indexer[];
	onJobStarted?: (jobId: string, initialMessage?: string) => void;
}) {
	const [dialogAction, setDialogAction] = useState<DialogAction | null>(null);

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
			{indexers.length > 0 && (
				<div className="ml-2 flex items-center gap-2">
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button size="icon" variant="ghost">
									<MoreHorizontal className="size-4" />
								</Button>
							}
						/>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onClick={() => setDialogAction("reindex")}>
								Reindex
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => setDialogAction("regenerate_thumbnails")}
							>
								Regenerate Thumbnails
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>

					{dialogAction && (
						<ActionDialog
							action={dialogAction}
							indexers={indexers}
							onJobStarted={onJobStarted}
							onOpenChange={(open) => {
								if (!open) {
									setDialogAction(null);
								}
							}}
							open
							videoId={video.id}
						/>
					)}
				</div>
			)}
		</div>
	);
}
