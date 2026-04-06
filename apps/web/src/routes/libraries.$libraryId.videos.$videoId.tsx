import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Pause, Play, Volume2, VolumeOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { trpc } from "@/utils/trpc";

const videoSearchSchema = z.object({
	start: z.number().optional(),
	end: z.number().optional(),
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

// --- Video Player ---

function VideoPlayer({
	filePath,
	startTime,
	endTime,
	duration,
}: {
	filePath: string;
	startTime?: number;
	endTime?: number;
	duration: number;
}) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const progressRef = useRef<HTMLDivElement>(null);
	const serverUrl = import.meta.env.VITE_SERVER_URL as string;
	const src = `${serverUrl}/api/video?path=${encodeURIComponent(filePath)}`;

	const clipStart = startTime ?? 0;
	const clipEnd = endTime ?? duration;
	const clipDuration = clipEnd - clipStart;
	const isClip = startTime !== undefined && endTime !== undefined;

	const [playing, setPlaying] = useState(false);
	const [muted, setMuted] = useState(true);
	const [progress, setProgress] = useState(0);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}

		let rafId: number;

		const tick = () => {
			const elapsed = video.currentTime - clipStart;
			setProgress(Math.min(Math.max(elapsed / clipDuration, 0), 1));

			if (isClip && !video.paused && video.currentTime >= clipEnd) {
				video.pause();
				video.currentTime = clipStart;
				setPlaying(false);
				setProgress(0);
			}
			rafId = requestAnimationFrame(tick);
		};

		const handleLoaded = () => {
			if (clipStart > 0) {
				video.currentTime = clipStart;
			}
		};

		const handlePlay = () => {
			setPlaying(true);
			rafId = requestAnimationFrame(tick);
		};

		const handlePause = () => {
			setPlaying(false);
			cancelAnimationFrame(rafId);
		};

		video.addEventListener("loadedmetadata", handleLoaded);
		video.addEventListener("play", handlePlay);
		video.addEventListener("pause", handlePause);

		return () => {
			cancelAnimationFrame(rafId);
			video.removeEventListener("loadedmetadata", handleLoaded);
			video.removeEventListener("play", handlePlay);
			video.removeEventListener("pause", handlePause);
			video.pause();
			video.removeAttribute("src");
			video.load();
		};
	}, [clipStart, clipEnd, clipDuration, isClip]);

	const togglePlay = useCallback(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}
		if (video.paused) {
			video.play();
		} else {
			video.pause();
		}
	}, []);

	const toggleMute = useCallback(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}
		video.muted = !video.muted;
		setMuted(video.muted);
	}, []);

	const seek = useCallback(
		(e: React.MouseEvent<HTMLDivElement>) => {
			const video = videoRef.current;
			const bar = progressRef.current;
			if (!(video && bar)) {
				return;
			}

			const rect = bar.getBoundingClientRect();
			const ratio = Math.min(
				Math.max((e.clientX - rect.left) / rect.width, 0),
				1
			);
			video.currentTime = clipStart + ratio * clipDuration;
			setProgress(ratio);
		},
		[clipStart, clipDuration]
	);

	const elapsed = progress * clipDuration;

	return (
		<div className="group relative overflow-hidden rounded-md bg-black">
			<video
				className="w-full"
				muted={muted}
				onClick={togglePlay}
				preload="metadata"
				ref={videoRef}
				src={src}
			/>

			<div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 pt-6 pb-2 opacity-0 transition-opacity group-hover:opacity-100">
				<button
					className="text-white hover:text-white/80"
					onClick={togglePlay}
					type="button"
				>
					{playing ? (
						<Pause className="size-4 fill-current" />
					) : (
						<Play className="size-4 fill-current" />
					)}
				</button>

				<div
					aria-label="Seek"
					aria-valuemax={100}
					aria-valuemin={0}
					aria-valuenow={Math.round(progress * 100)}
					className="relative flex h-5 flex-1 cursor-pointer items-center"
					onClick={seek}
					onKeyDown={(e) => {
						const video = videoRef.current;
						if (!video) {
							return;
						}
						const step = clipDuration * 0.05;
						if (e.key === "ArrowRight") {
							video.currentTime = Math.min(video.currentTime + step, clipEnd);
						} else if (e.key === "ArrowLeft") {
							video.currentTime = Math.max(video.currentTime - step, clipStart);
						}
					}}
					ref={progressRef}
					role="slider"
					tabIndex={0}
				>
					<div className="h-1 w-full rounded-full bg-white/30">
						<div
							className="h-full rounded-full bg-white"
							style={{ width: `${progress * 100}%` }}
						/>
					</div>
				</div>

				<span className="min-w-14 text-right font-mono text-white/80 text-xs">
					{formatTime(elapsed)} / {formatTime(clipDuration)}
				</span>

				<button
					className="text-white hover:text-white/80"
					onClick={toggleMute}
					type="button"
				>
					{muted ? (
						<VolumeOff className="size-4" />
					) : (
						<Volume2 className="size-4" />
					)}
				</button>
			</div>
		</div>
	);
}

// --- Video Detail Page ---

function VideoDetailPage() {
	const { libraryId, videoId } = Route.useParams();
	const { start, end } = Route.useSearch();

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

	const hasClip = start !== undefined && end !== undefined;

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
				{hasClip ? (
					<VideoPlayer
						duration={video.duration ?? 0}
						endTime={end}
						filePath={video.filePath}
						startTime={start}
					/>
				) : (
					// biome-ignore lint/a11y/useMediaCaption: user-uploaded video
					<video
						className="w-full rounded-md"
						controls
						muted
						preload="metadata"
						src={`${import.meta.env.VITE_SERVER_URL as string}/api/video?path=${encodeURIComponent(video.filePath)}`}
					/>
				)}
			</div>

			<div className="space-y-1">
				<h2 className="font-medium">{video.fileName}</h2>
				<div className="flex items-center gap-3 text-muted-foreground text-sm">
					{video.duration != null && (
						<span>Duration: {formatTime(video.duration)}</span>
					)}
					{hasClip && (
						<span>
							Clip: {formatTime(start)} – {formatTime(end)}
						</span>
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
