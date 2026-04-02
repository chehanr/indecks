import { Button } from "@indecks/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@indecks/ui/components/card";
import { Input } from "@indecks/ui/components/input";
import { Label } from "@indecks/ui/components/label";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/search")({
	component: SearchPage,
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data) {
			redirect({ to: "/login", throw: true });
		}
	},
});

function formatTime(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, "0")}`;
}

interface SearchResult {
	chunkId: string;
	endTime: number;
	fileName: string;
	filePath: string;
	libraryId: string;
	score: number;
	startTime: number;
	videoId: string;
}

function VideoPlayer({
	filePath,
	startTime,
}: {
	filePath: string;
	startTime: number;
}) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const serverUrl = import.meta.env.VITE_SERVER_URL as string;
	const src = `${serverUrl}/api/video?path=${encodeURIComponent(filePath)}#t=${startTime}`;

	return (
		// biome-ignore lint/a11y/useMediaCaption: video files may not have captions
		<video
			className="w-full rounded-md"
			controls
			preload="metadata"
			ref={videoRef}
			src={src}
		/>
	);
}

function SearchResultCard({ result }: { result: SearchResult }) {
	const [showPlayer, setShowPlayer] = useState(false);

	return (
		<Card>
			<CardContent className="py-4">
				<div className="flex flex-col gap-3">
					<div className="flex items-center justify-between">
						<div className="min-w-0 flex-1">
							<p className="truncate font-medium text-sm">{result.fileName}</p>
							<p className="text-muted-foreground text-xs">
								{formatTime(result.startTime)} - {formatTime(result.endTime)}
							</p>
						</div>
						<div className="ml-2 flex items-center gap-2">
							<span className="text-muted-foreground text-xs">
								{(result.score * 100).toFixed(1)}%
							</span>
							<Button
								onClick={() => setShowPlayer(!showPlayer)}
								size="sm"
								variant="outline"
							>
								{showPlayer ? "Hide" : "Play"}
							</Button>
						</div>
					</div>
					{showPlayer && (
						<VideoPlayer
							filePath={result.filePath}
							startTime={result.startTime}
						/>
					)}
				</div>
			</CardContent>
		</Card>
	);
}

function SearchPage() {
	const [query, setQuery] = useState("");
	const [libraryId, setLibraryId] = useState("");
	const [searchQuery, setSearchQuery] = useState("");

	const librariesQuery = useQuery(trpc.library.list.queryOptions());

	const searchResults = useQuery({
		...trpc.search.query.queryOptions({
			query: searchQuery,
			libraryId: libraryId || undefined,
			limit: 20,
		}),
		enabled: searchQuery.length > 0,
	});

	const handleSearch = (e: React.FormEvent) => {
		e.preventDefault();
		if (query.trim()) {
			setSearchQuery(query.trim());
		}
	};

	return (
		<div className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
			<h1 className="font-bold text-2xl">Search</h1>

			<Card>
				<CardContent className="pt-6">
					<form className="flex flex-col gap-4" onSubmit={handleSearch}>
						<div className="flex flex-col gap-2">
							<Label htmlFor="query">Search Query</Label>
							<Input
								id="query"
								onChange={(e) => setQuery(e.target.value)}
								placeholder="Describe what you're looking for..."
								value={query}
							/>
						</div>
						<div className="flex flex-col gap-2">
							<Label htmlFor="library">Library (optional)</Label>
							<select
								className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
								id="library"
								onChange={(e) => setLibraryId(e.target.value)}
								value={libraryId}
							>
								<option value="">All libraries</option>
								{librariesQuery.data?.map((lib) => (
									<option key={lib.id} value={lib.id}>
										{lib.name}
									</option>
								))}
							</select>
						</div>
						<Button
							disabled={!query.trim() || searchResults.isFetching}
							type="submit"
						>
							{searchResults.isFetching ? "Searching..." : "Search"}
						</Button>
					</form>
				</CardContent>
			</Card>

			{searchResults.data && searchResults.data.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle>Results ({searchResults.data.length})</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						{searchResults.data.map((result) => (
							<SearchResultCard key={result.chunkId} result={result} />
						))}
					</CardContent>
				</Card>
			)}

			{searchResults.data?.length === 0 && (
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
