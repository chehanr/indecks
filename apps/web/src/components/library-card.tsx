import { Badge } from "@indecks/ui/components/badge";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@indecks/ui/components/card";
import { Link } from "@tanstack/react-router";

const statusVariant: Record<
	string,
	"default" | "secondary" | "destructive" | "outline"
> = {
	idle: "secondary",
	scanning: "outline",
	indexing: "outline",
	ready: "default",
	error: "destructive",
};

export function LibraryCard({
	library,
}: {
	library: {
		id: string;
		name: string;
		folderPaths: string;
		status: string;
		videoCount: number;
	};
}) {
	const paths: string[] = JSON.parse(library.folderPaths);

	return (
		<Link params={{ libraryId: library.id }} to="/libraries/$libraryId">
			<Card className="transition-colors hover:border-foreground/20">
				<CardHeader>
					<div className="flex items-center justify-between">
						<CardTitle>{library.name}</CardTitle>
						<Badge variant={statusVariant[library.status] ?? "secondary"}>
							{library.status}
						</Badge>
					</div>
					<CardDescription className="truncate">
						{paths.length === 1 ? paths[0] : `${paths.length} folders`}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<p className="text-muted-foreground text-sm">
						{library.videoCount} videos
					</p>
				</CardContent>
			</Card>
		</Link>
	);
}
