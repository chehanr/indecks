import { Badge } from "@indecks/ui/components/badge";
import { Link } from "@tanstack/react-router";

import { formatTime, VideoPlayer } from "@/components/video-player";

export interface SearchResult {
	chunkId: string;
	distance: number;
	endTime: number;
	fileName: string;
	filePath: string;
	libraryId: string;
	score: number;
	startTime: number;
	videoId: string;
}

export function ResultCard({ result }: { result: SearchResult }) {
	return (
		<div className="flex flex-col border">
			<div className="p-2">
				<VideoPlayer
					endTime={result.endTime}
					filePath={result.filePath}
					startTime={result.startTime}
				/>
			</div>
			<div className="px-2 py-1.5">
				<div className="flex items-center justify-between gap-1">
					<Link
						className="min-w-0 truncate text-xs hover:underline"
						params={{
							libraryId: result.libraryId,
							videoId: result.videoId,
						}}
						to="/libraries/$libraryId/videos/$videoId"
					>
						{result.fileName}
					</Link>
					<Badge variant="secondary">{(result.score * 100).toFixed(1)}%</Badge>
				</div>
				<Link
					className="text-[10px] text-muted-foreground hover:underline"
					params={{
						libraryId: result.libraryId,
						videoId: result.videoId,
					}}
					search={{
						start: result.startTime,
					}}
					to="/libraries/$libraryId/videos/$videoId"
				>
					{formatTime(result.startTime)} – {formatTime(result.endTime)}
				</Link>
			</div>
		</div>
	);
}
