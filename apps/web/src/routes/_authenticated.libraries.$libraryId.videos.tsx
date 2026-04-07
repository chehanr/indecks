import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute(
	"/_authenticated/libraries/$libraryId/videos"
)({
	component: VideosLayout,
});

function VideosLayout() {
	return <Outlet />;
}
