import { Button } from "@indecks/ui/components/button";
import { Card, CardContent } from "@indecks/ui/components/card";
import {
	Progress,
	ProgressLabel,
	ProgressValue,
} from "@indecks/ui/components/progress";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

import { queryClient, trpcClient } from "@/utils/trpc";

export function JobProgress({
	jobId,
	onDone,
}: {
	jobId: string;
	onDone?: () => void;
}) {
	const [state, setState] = useState({
		status: "running",
		progress: 0,
		progressMessage: null as string | null,
		errorMessage: null as string | null,
	});

	useEffect(() => {
		const sub = trpcClient.job.onProgress.subscribe(
			{ jobId },
			{
				onData(event) {
					setState({
						status: event.status,
						progress: event.progress,
						progressMessage: event.progressMessage,
						errorMessage: event.errorMessage,
					});
					if (
						event.status === "completed" ||
						event.status === "failed" ||
						event.status === "cancelled"
					) {
						queryClient.invalidateQueries({
							queryKey: [["library", "videos"]],
						});
						queryClient.invalidateQueries({ queryKey: [["library", "get"]] });
						setTimeout(() => onDone?.(), 3000);
					}
				},
			}
		);
		return () => sub.unsubscribe();
	}, [jobId, onDone]);

	const isActive = state.status === "running" || state.status === "pending";

	const handleCancel = () => {
		trpcClient.job.cancel.mutate({ id: jobId }).then(() => {
			setState((prev) => ({ ...prev, status: "cancelled" }));
			queryClient.invalidateQueries({ queryKey: [["library", "videos"]] });
			queryClient.invalidateQueries({ queryKey: [["library", "get"]] });
			setTimeout(() => onDone?.(), 3000);
		});
	};

	let statusLabel = state.progressMessage ?? "Starting...";
	if (state.status === "completed") {
		statusLabel = "Complete";
	} else if (state.status === "failed") {
		statusLabel = "Failed";
	} else if (state.status === "cancelled") {
		statusLabel = "Cancelled";
	}

	return (
		<Card>
			<CardContent className="py-4">
				<div className="flex items-center gap-2">
					<div className="flex-1">
						<Progress value={state.progress === -1 ? null : state.progress}>
							<ProgressLabel>{statusLabel}</ProgressLabel>
							{state.progress !== -1 && <ProgressValue />}
						</Progress>
					</div>
					{isActive && (
						<Button
							className="h-6 w-6 shrink-0"
							onClick={handleCancel}
							size="icon"
							variant="ghost"
						>
							<X className="h-4 w-4" />
						</Button>
					)}
				</div>
				{state.errorMessage && (
					<p className="mt-2 text-destructive text-xs">{state.errorMessage}</p>
				)}
			</CardContent>
		</Card>
	);
}
