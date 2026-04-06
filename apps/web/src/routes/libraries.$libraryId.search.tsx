import { Badge } from "@indecks/ui/components/badge";
import { Input } from "@indecks/ui/components/input";
import {
	NativeSelect,
	NativeSelectOption,
} from "@indecks/ui/components/native-select";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { parseAsString, useQueryState } from "nuqs";
import { useEffect, useRef, useState } from "react";
import { useDebouncedCallback } from "use-debounce";

import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/libraries/$libraryId/search")({
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
	const serverUrl = import.meta.env.VITE_SERVER_URL as string;
	const src = `${serverUrl}/api/video?path=${encodeURIComponent(filePath)}&start=${startTime}&end=${endTime}`;
	const poster = `${serverUrl}/api/thumbnail?path=${encodeURIComponent(filePath)}&time=${startTime}`;

	useEffect(() => {
		return () => {
			const video = videoRef.current;
			if (video) {
				video.pause();
				video.removeAttribute("src");
				video.load();
			}
		};
	}, []);

	return (
		<video
			className="w-full rounded-md"
			controls
			muted
			poster={poster}
			preload="none"
			ref={videoRef}
			src={src}
		/>
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
					<p className="min-w-0 truncate text-xs">{result.fileName}</p>
					<Badge variant="secondary">{(result.score * 100).toFixed(1)}%</Badge>
				</div>
				<p className="text-[10px] text-muted-foreground">
					{formatTime(result.startTime)} – {formatTime(result.endTime)}
				</p>
			</div>
		</div>
	);
}

// --- Search Page ---

function SearchPage() {
	const { libraryId } = Route.useParams();

	const [searchQuery, setSearchQuery] = useQueryState(
		"q",
		parseAsString.withDefault("")
	);
	const [indexerId, setIndexerId] = useQueryState(
		"indexer",
		parseAsString.withDefault("")
	);
	const [inputValue, setInputValue] = useState(searchQuery);

	const indexersQuery = useQuery(trpc.indexer.list.queryOptions({ libraryId }));

	const defaultIndexer = indexersQuery.data?.find((e) => e.isDefault);
	const selectedIndexerId = indexerId || defaultIndexer?.id || "";

	const debouncedSearch = useDebouncedCallback((value: string) => {
		setSearchQuery(value.trim() || null);
	}, 400);

	const handleInputChange = (value: string) => {
		setInputValue(value);
		debouncedSearch(value);
	};

	const searchResults = useQuery({
		...trpc.search.query.queryOptions({
			query: searchQuery,
			libraryId,
			indexerId: selectedIndexerId || undefined,
			limit: 20,
		}),
		enabled: searchQuery.length > 0 && selectedIndexerId.length > 0,
	});

	return (
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

			{indexersQuery.data && indexersQuery.data.length > 0 && (
				<NativeSelect
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

			{searchResults.data?.debug && (
				<p className="font-mono text-muted-foreground text-xs">
					{searchResults.data.results.length} results from{" "}
					{searchResults.data.debug.totalVectors} vectors (
					{searchResults.data.debug.dimensions}d) | embed:{" "}
					{searchResults.data.debug.embedMs}ms | search:{" "}
					{searchResults.data.debug.searchMs}ms | indexer:{" "}
					{searchResults.data.debug.indexerName}
				</p>
			)}

			{searchResults.isLoading && searchQuery.length > 0 && (
				<p className="text-muted-foreground text-sm">Searching...</p>
			)}

			{searchResults.data && searchResults.data.results.length > 0 && (
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
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
	);
}
