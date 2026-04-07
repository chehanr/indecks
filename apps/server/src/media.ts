import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import type { Auth } from "@indecks/auth";

const RANGE_PATTERN = /bytes=(\d+)-(\d*)/;

interface MediaHandlerOptions {
	auth: Auth;
	corsHeaders: Record<string, string>;
	thumbnailDir: string;
	validateFilePath: (
		filePath: string
	) => Promise<{ absPath: string } | { error: string; status: 403 }>;
}

function serveFileRange(
	file: ReturnType<typeof Bun.file>,
	fileSize: number,
	req: Request,
	meta: { contentType: string; disposition: string; etag: string },
	corsHeaders: Record<string, string>
): Response {
	const range = req.headers.get("Range");
	const rangeMatch = range?.match(RANGE_PATTERN);

	if (rangeMatch) {
		const start = Number.parseInt(rangeMatch[1] ?? "0", 10);
		const end = rangeMatch[2]
			? Number.parseInt(rangeMatch[2], 10)
			: fileSize - 1;

		if (start >= fileSize || end >= fileSize) {
			return new Response(null, {
				status: 416,
				headers: { "Content-Range": `bytes */${fileSize}`, ...corsHeaders },
			});
		}

		return new Response(file.slice(start, end + 1), {
			status: 206,
			headers: {
				"Content-Range": `bytes ${start}-${end}/${fileSize}`,
				"Accept-Ranges": "bytes",
				"Content-Length": String(end - start + 1),
				"Content-Type": meta.contentType,
				"Content-Disposition": meta.disposition,
				"Cache-Control": "public, max-age=86400",
				ETag: meta.etag,
				...corsHeaders,
			},
		});
	}

	return new Response(file, {
		headers: {
			"Accept-Ranges": "bytes",
			"Content-Length": String(fileSize),
			"Content-Type": meta.contentType,
			"Content-Disposition": meta.disposition,
			"Cache-Control": "public, max-age=86400",
			ETag: meta.etag,
			...corsHeaders,
		},
	});
}

export function createMediaHandlers(opts: MediaHandlerOptions) {
	const { auth, corsHeaders, thumbnailDir, validateFilePath } = opts;

	async function handleVideo(req: Request): Promise<Response> {
		const session = await auth.api.getSession({ headers: req.headers });
		if (!session) {
			return new Response("Unauthorized", {
				status: 401,
				headers: corsHeaders,
			});
		}

		const url = new URL(req.url);
		const filePath = url.searchParams.get("path");
		if (!filePath) {
			return new Response("Missing path parameter", { status: 400 });
		}

		const result = await validateFilePath(filePath);
		if ("error" in result) {
			return new Response(result.error, {
				status: result.status,
				headers: corsHeaders,
			});
		}

		const fileStat = await stat(result.absPath).catch(() => null);
		if (!fileStat) {
			return new Response("File not found", { status: 404 });
		}

		const fileSize = fileStat.size;
		const file = Bun.file(result.absPath);
		const etag = `"${fileStat.mtimeMs.toString(36)}-${fileSize.toString(36)}"`;

		if (req.headers.get("If-None-Match") === etag) {
			return new Response(null, { status: 304, headers: corsHeaders });
		}

		return serveFileRange(
			file,
			fileSize,
			req,
			{
				contentType: file.type || "application/octet-stream",
				disposition: `inline; filename="${encodeURIComponent(basename(result.absPath))}"`,
				etag,
			},
			corsHeaders
		);
	}

	async function handleThumbnail(req: Request): Promise<Response> {
		const session = await auth.api.getSession({ headers: req.headers });
		if (!session) {
			return new Response("Unauthorized", {
				status: 401,
				headers: corsHeaders,
			});
		}

		const url = new URL(req.url);
		const filePath = url.searchParams.get("path");
		const time = url.searchParams.get("time");
		if (!filePath || time === null) {
			return new Response("Missing path or time parameter", { status: 400 });
		}

		const seconds = Number.parseFloat(time);
		if (Number.isNaN(seconds) || seconds < 0) {
			return new Response("Invalid time parameter", { status: 400 });
		}

		const result = await validateFilePath(filePath);
		if ("error" in result) {
			return new Response(result.error, {
				status: result.status,
				headers: corsHeaders,
			});
		}

		const pathHash = createHash("sha256")
			.update(result.absPath)
			.digest("hex")
			.slice(0, 16);
		const thumbPath = resolve(thumbnailDir, `${pathHash}_${seconds}.jpg`);

		const thumbStat = await stat(thumbPath).catch(() => null);
		if (!thumbStat) {
			return new Response("Thumbnail not found", {
				status: 404,
				headers: corsHeaders,
			});
		}
		const thumbEtag = `"thumb-${thumbStat.mtimeMs.toString(36)}"`;

		if (req.headers.get("If-None-Match") === thumbEtag) {
			return new Response(null, { status: 304, headers: corsHeaders });
		}

		const file = Bun.file(thumbPath);
		return new Response(file, {
			headers: {
				"Content-Type": "image/jpeg",
				"Cache-Control": "public, max-age=604800, immutable",
				ETag: thumbEtag,
				...corsHeaders,
			},
		});
	}

	function handlePreflight(): Response {
		return new Response(null, {
			headers: {
				...corsHeaders,
				"Access-Control-Allow-Methods": "GET, OPTIONS",
				"Access-Control-Allow-Headers": "Range, Authorization",
				"Access-Control-Allow-Credentials": "true",
				"Access-Control-Max-Age": "86400",
			},
		});
	}

	return { handleVideo, handleThumbnail, handlePreflight };
}
