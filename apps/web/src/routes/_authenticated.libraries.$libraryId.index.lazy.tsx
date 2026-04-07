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
import { createLazyFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useState } from "react";
import { useDebouncedCallback } from "use-debounce";

import { BreadcrumbPortal } from "@/components/breadcrumb-slot";
import { ResultCard } from "@/components/result-card";
import { useLibrary } from "@/hooks/use-library";
import { trpc } from "@/utils/trpc";

export const Route = createLazyFileRoute(
	"/_authenticated/libraries/$libraryId/"
)({
	component: SearchPage,
});

const PAGE_SIZE_OPTIONS = [12, 20, 40, 60] as const;
const DEFAULT_PAGE_SIZE = 20;

function SearchPage() {
	const { libraryId } = Route.useParams();
	const library = useLibrary();

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
								{library.name}
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
