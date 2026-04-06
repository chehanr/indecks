import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";

import { trpc } from "@/utils/trpc";

const videoSearchSchema = z.object({
	start: z.number().optional(),
});

export const Route = createFileRoute("/libraries/$libraryId/videos/$videoId")({
	component: VideoDetailPage,
	validateSearch: videoSearchSchema,
});

function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

// --- Video Detail Page ---

function VideoDetailPage() {
	const { libraryId, videoId } = Route.useParams();
	const { start } = Route.useSearch();

	const videoQuery = useQuery(trpc.library.video.queryOptions({ id: videoId }));

	const video = videoQuery.data;

	if (videoQuery.isLoading) {
		return (
			<div>
				<p className="text-muted-foreground text-sm">Loading...</p>
			</div>
		);
	}

	if (!video) {
		return (
			<div>
				<p className="text-destructive text-sm">Video not found</p>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 text-sm">
				<Link
					className="text-muted-foreground hover:underline"
					params={{ libraryId }}
					to="/libraries/$libraryId/videos"
				>
					Videos
				</Link>
				<span className="text-muted-foreground">/</span>
				<span className="truncate">{video.fileName}</span>
			</div>

			<div className="mx-auto max-w-4xl">
				<video
					className="w-full rounded-md"
					controls
					muted
					preload="metadata"
					ref={(el) => {
						if (el && start !== undefined) {
							el.currentTime = start;
						}
					}}
					src={`${import.meta.env.VITE_SERVER_URL as string}/api/video?path=${encodeURIComponent(video.filePath)}`}
				/>
			</div>

			<div className="space-y-1">
				<h2 className="font-medium">{video.fileName}</h2>
				<div className="flex items-center gap-3 text-muted-foreground text-sm">
					{video.duration != null && (
						<span>Duration: {formatTime(video.duration)}</span>
					)}
					<span className="capitalize">Status: {video.status}</span>
				</div>
				<p className="truncate text-muted-foreground text-xs">
					{video.filePath}
				</p>
			</div>
		</div>
	);
}
