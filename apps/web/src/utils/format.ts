export const statusColors: Record<string, string> = {
	pending: "text-muted-foreground",
	processing: "text-yellow-600",
	indexed: "text-green-600",
	error: "text-destructive",
};

export function formatFileSize(bytes: number | null): string {
	if (bytes == null) {
		return "—";
	}
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	if (bytes < 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatDuration(seconds: number | null): string {
	if (seconds == null) {
		return "—";
	}
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (h > 0) {
		return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
	}
	return `${m}:${String(s).padStart(2, "0")}`;
}
