import { Badge } from "@indecks/ui/components/badge";
import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@indecks/ui/components/breadcrumb";
import { Input } from "@indecks/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@indecks/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Pause, Play, Search, Volume2, VolumeOff } from "lucide-react";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

import { BreadcrumbPortal } from "@/components/breadcrumb-slot";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/libraries/$libraryId/")({
	component: SearchPage,
});

function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

interface SearchResult {
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

// --- Video Player ---

function VideoPlayer({
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
		<div className="group relative overflow-hidden rounded-md">
			<video
				className="w-full"
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

// --- Result Card ---

function ResultCard({ result }: { result: SearchResult }) {
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

// --- Search Page ---

const PAGE_SIZE_OPTIONS = [12, 20, 40, 60] as const;
const DEFAULT_PAGE_SIZE = 20;

function SearchPage() {
	const { libraryId } = Route.useParams();

	const libraryQuery = useQuery(
		trpc.library.get.queryOptions({ id: libraryId })
	);
	const libraryName = libraryQuery.data?.name ?? "...";

	const [searchQuery, setSearchQuery] = useQueryState(
		"q",
		parseAsString.withDefault("")
	);
	const [indexerId, setIndexerId] = useQueryState(
		"indexer",
		parseAsString.withDefault("")
	);
	const [pageSize, setPageSize] = useQueryState(
		"size",
		parseAsInteger.withDefault(DEFAULT_PAGE_SIZE)
	);
	const [inputValue, setInputValue] = useState(searchQuery);

	const indexersQuery = useQuery(trpc.indexer.list.queryOptions({ libraryId }));

	const defaultIndexer = indexersQuery.data?.find((e) => e.isDefault);
	const selectedIndexerId = indexerId || defaultIndexer?.id || "";

	const effectivePageSize = PAGE_SIZE_OPTIONS.includes(
		pageSize as (typeof PAGE_SIZE_OPTIONS)[number]
	)
		? pageSize
		: DEFAULT_PAGE_SIZE;

	const debouncedSearch = useDebouncedCallback((value: string) => {
		setSearchQuery(value.trim() || null);
	}, 400);

	const handleInputChange = (value: string) => {
		setInputValue(value);
		debouncedSearch(value);
	};

	const handlePageSizeChange = (size: number) => {
		setPageSize(size === DEFAULT_PAGE_SIZE ? null : size);
	};

	const searchResults = useQuery({
		...trpc.search.query.queryOptions({
			query: searchQuery,
			libraryId,
			indexerId: selectedIndexerId || undefined,
			limit: effectivePageSize,
		}),
		enabled: searchQuery.length > 0 && selectedIndexerId.length > 0,
	});

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
								{libraryName}
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>Search</BreadcrumbPage>
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
						placeholder="Describe what you're looking for..."
						value={inputValue}
					/>
				</div>

				<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
					{indexersQuery.data && indexersQuery.data.length > 0 && (
						<NativeSelect
							className="min-w-0 flex-1"
							onChange={(e) => setIndexerId(e.target.value || null)}
							value={selectedIndexerId}
						>
							{indexersQuery.data.map((idx) => (
								<NativeSelectOption key={idx.id} value={idx.id}>
									{idx.name} ({idx.model}, {idx.dimensions}d)
									{idx.isDefault ? " — default" : ""}
								</NativeSelectOption>
							))}
						</NativeSelect>
					)}
					<NativeSelect
						className="w-auto"
						onChange={(e) =>
							handlePageSizeChange(Number.parseInt(e.target.value, 10))
						}
						value={effectivePageSize}
					>
						{PAGE_SIZE_OPTIONS.map((size) => (
							<NativeSelectOption key={size} value={size}>
								{size} results
							</NativeSelectOption>
						))}
					</NativeSelect>
				</div>

				{searchResults.data?.debug && (
					<p className="font-mono text-muted-foreground text-xs">
						{searchResults.data.results.length} results from{" "}
						{searchResults.data.debug.totalVectors} vectors (
						{searchResults.data.debug.dimensions}d) | embed:{" "}
						{searchResults.data.debug.embedMs}ms | search:{" "}
						{searchResults.data.debug.searchMs}ms
					</p>
				)}

				{searchResults.isLoading && searchQuery.length > 0 && (
					<p className="text-muted-foreground text-sm">Searching...</p>
				)}

				{searchResults.data && searchResults.data.results.length > 0 && (
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{searchResults.data.results.map((result) => (
							<ResultCard key={result.chunkId} result={result} />
						))}
					</div>
				)}

				{searchResults.data?.results.length === 0 && (
					<p className="text-muted-foreground text-sm">
						No results found. Try a different query.
					</p>
				)}

				{searchResults.error && (
					<p className="text-destructive text-sm">
						{searchResults.error.message}
					</p>
				)}
			</div>
		</>
	);
}
