import {
	Breadcrumb,
	BreadcrumbItem,
	BreadcrumbLink,
	BreadcrumbList,
	BreadcrumbPage,
	BreadcrumbSeparator,
} from "@indecks/ui/components/breadcrumb";
import { useQuery } from "@tanstack/react-query";
import { createLazyFileRoute, Link } from "@tanstack/react-router";

import { BreadcrumbPortal } from "@/components/breadcrumb-slot";
import { formatTime } from "@/components/video-player";
import { useLibrary } from "@/hooks/use-library";
import { trpc } from "@/utils/trpc";

export const Route = createLazyFileRoute(
	"/_authenticated/libraries/$libraryId/videos/$videoId"
)({
	component: VideoDetailPage,
});

function VideoDetailPage() {
	const { libraryId, videoId } = Route.useParams();
	const { start } = Route.useSearch();
	const library = useLibrary();

	const videoQuery = useQuery(trpc.library.video.queryOptions({ id: videoId }));
	const video = videoQuery.data;

	if (videoQuery.isLoading) {
		return <p className="text-muted-foreground text-sm">Loading...</p>;
	}

	if (!video) {
		return <p className="text-destructive text-sm">Video not found</p>;
	}

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
							<BreadcrumbLink
								render={
									<Link
										params={{ libraryId }}
										to="/libraries/$libraryId/videos"
									/>
								}
							>
								Videos
							</BreadcrumbLink>
						</BreadcrumbItem>
						<BreadcrumbSeparator />
						<BreadcrumbItem>
							<BreadcrumbPage>{video.fileName}</BreadcrumbPage>
						</BreadcrumbItem>
					</BreadcrumbList>
				</Breadcrumb>
			</BreadcrumbPortal>

			<div className="space-y-4">
				<div className="mx-auto max-w-4xl">
					<video
						className="w-full rounded-md"
						controls
						muted
						preload="metadata"
						ref={(el) => {
							if (el && start !== undefined) {
								el.currentTime = start;
								el.play();
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
		</>
	);
}
