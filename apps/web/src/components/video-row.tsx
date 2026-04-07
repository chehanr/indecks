import { Link } from "@tanstack/react-router";

import type { Indexer } from "@/components/video-actions";
import { VideoActionsMenu } from "@/components/video-actions";
import { formatDuration, formatFileSize, statusColors } from "@/utils/format";

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
		fileSize: number | null;
		duration: number | null;
		status: string;
		indexedBy: string[];
	};
	indexers: Indexer[];
	onJobStarted?: (jobId: string, initialMessage?: string) => void;
}) {
	return (
		<div className="flex items-center justify-between gap-4 py-2">
			<div className="min-w-0 flex-1">
				<Link
					className="block truncate font-medium text-sm hover:underline"
					params={{ libraryId, videoId: video.id }}
					to="/libraries/$libraryId/videos/$videoId"
				>
					{video.fileName}
				</Link>
				<div className="flex items-center gap-3 text-muted-foreground text-xs">
					<span className={statusColors[video.status] ?? ""}>
						{video.status}
					</span>
					<span>{formatDuration(video.duration)}</span>
					<span>{formatFileSize(video.fileSize)}</span>
					{video.indexedBy.length > 0 && (
						<span>indexed by: {video.indexedBy.join(", ")}</span>
					)}
				</div>
			</div>
			<VideoActionsMenu
				indexers={indexers}
				onJobStarted={onJobStarted}
				videoId={video.id}
			/>
		</div>
	);
}
