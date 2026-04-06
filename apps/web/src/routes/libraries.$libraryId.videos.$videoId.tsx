import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const videoSearchSchema = z.object({
	start: z.number().optional(),
});

export const Route = createFileRoute("/libraries/$libraryId/videos/$videoId")({
	validateSearch: videoSearchSchema,
});
