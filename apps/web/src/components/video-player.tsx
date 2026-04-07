import { Pause, Play, Volume2, VolumeOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function VideoPlayer({
	filePath,
	startTime,
	endTime,
}: {
	endTime: number;
	filePath: string;
	startTime: number;
}) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const progressRef = useRef<HTMLDivElement>(null);
	const serverUrl = import.meta.env.VITE_SERVER_URL as string;
	const src = `${serverUrl}/api/video?path=${encodeURIComponent(filePath)}`;
	const poster = `${serverUrl}/api/thumbnail?path=${encodeURIComponent(filePath)}&time=${startTime}`;

	const duration = endTime - startTime;
	const [playing, setPlaying] = useState(false);
	const [muted, setMuted] = useState(true);
	const [progress, setProgress] = useState(0);
	const [loaded, setLoaded] = useState(false);

	useEffect(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}

		let rafId: number;

		const tick = () => {
			const elapsed = video.currentTime - startTime;
			setProgress(Math.min(Math.max(elapsed / duration, 0), 1));

			if (!video.paused && video.currentTime >= endTime) {
				video.pause();
				video.currentTime = startTime;
				setPlaying(false);
				setProgress(0);
			}
			rafId = requestAnimationFrame(tick);
		};

		const handleLoaded = () => {
			video.currentTime = startTime;
			setLoaded(true);
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
	}, [startTime, endTime, duration]);

	const togglePlay = useCallback(() => {
		const video = videoRef.current;
		if (!video) {
			return;
		}

		if (!loaded) {
			video.load();
		}

		if (video.paused) {
			video.play();
		} else {
			video.pause();
		}
	}, [loaded]);

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
			video.currentTime = startTime + ratio * duration;
			setProgress(ratio);
		},
		[startTime, duration]
	);

	const elapsed = progress * duration;

	return (
		<div className="group relative aspect-video overflow-hidden rounded-md">
			<video
				className="size-full object-contain"
				muted={muted}
				onClick={togglePlay}
				poster={poster}
				preload="none"
				ref={videoRef}
				src={src}
			/>

			<div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/70 to-transparent px-2 pt-4 pb-1.5 opacity-0 transition-opacity group-hover:opacity-100">
				<button
					className="text-white hover:text-white/80"
					onClick={togglePlay}
					type="button"
				>
					{playing ? (
						<Pause className="size-3.5 fill-current" />
					) : (
						<Play className="size-3.5 fill-current" />
					)}
				</button>

				<div
					aria-label="Seek"
					aria-valuemax={100}
					aria-valuemin={0}
					aria-valuenow={Math.round(progress * 100)}
					className="relative flex h-4 flex-1 cursor-pointer items-center"
					onClick={seek}
					onKeyDown={(e) => {
						const video = videoRef.current;
						if (!video) {
							return;
						}
						const step = duration * 0.05;
						if (e.key === "ArrowRight") {
							video.currentTime = Math.min(video.currentTime + step, endTime);
						} else if (e.key === "ArrowLeft") {
							video.currentTime = Math.max(video.currentTime - step, startTime);
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

				<span className="min-w-[3.5rem] text-right font-mono text-[10px] text-white/80">
					{formatTime(elapsed)} / {formatTime(duration)}
				</span>

				<button
					className="text-white hover:text-white/80"
					onClick={toggleMute}
					type="button"
				>
					{muted ? (
						<VolumeOff className="size-3.5" />
					) : (
						<Volume2 className="size-3.5" />
					)}
				</button>
			</div>
		</div>
	);
}
