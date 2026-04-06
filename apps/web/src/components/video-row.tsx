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
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { queryClient, trpcClient } from "@/utils/trpc";

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
