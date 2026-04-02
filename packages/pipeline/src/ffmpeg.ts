import { readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SUPPORTED_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm"]);

interface ChunkInfo {
	chunkPath: string;
	endTime: number;
	sourceFile: string;
	startTime: number;
}

interface ChunkOptions {
	chunkDuration?: number;
	overlap?: number;
}

interface FrameOptions {
	count?: number;
}

async function run(
	cmd: string,
	args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const proc = Bun.spawn([cmd, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
	]);
	const exitCode = await proc.exited;
	return { stdout, stderr, exitCode };
}

export async function getVideoDuration(filePath: string): Promise<number> {
	const { stdout, exitCode } = await run("ffprobe", [
		"-v",
		"quiet",
		"-print_format",
		"json",
		"-show_format",
		filePath,
	]);
	if (exitCode !== 0) {
		throw new Error(`ffprobe failed for ${filePath}`);
	}
	const info = JSON.parse(stdout) as { format: { duration: string } };
	return Number.parseFloat(info.format.duration);
}

export async function chunkVideo(
	filePath: string,
	options: ChunkOptions = {}
): Promise<ChunkInfo[]> {
	const { chunkDuration = 30, overlap = 5 } = options;
	const absPath = resolve(filePath);
	const duration = await getVideoDuration(absPath);
	const tmpDir = join(tmpdir(), `indecks_chunks_${Date.now()}`);
	await Bun.write(join(tmpDir, ".keep"), "");

	const step = chunkDuration - overlap;
	const chunks: ChunkInfo[] = [];

	if (duration <= chunkDuration) {
		const chunkPath = join(tmpDir, "chunk_000.mp4");
		const { exitCode } = await run("ffmpeg", [
			"-y",
			"-ss",
			"0",
			"-i",
			absPath,
			"-t",
			String(duration),
			"-c",
			"copy",
			chunkPath,
		]);
		if (exitCode !== 0) {
			throw new Error(`ffmpeg chunk failed for ${absPath}`);
		}
		return [
			{
				chunkPath,
				sourceFile: absPath,
				startTime: 0,
				endTime: duration,
			},
		];
	}

	let start = 0;
	let idx = 0;
	while (start < duration) {
		const end = Math.min(start + chunkDuration, duration);
		const t = end - start;
		const chunkPath = join(tmpDir, `chunk_${String(idx).padStart(3, "0")}.mp4`);

		const { exitCode } = await run("ffmpeg", [
			"-y",
			"-ss",
			String(start),
			"-i",
			absPath,
			"-t",
			String(t),
			"-c",
			"copy",
			chunkPath,
		]);
		if (exitCode !== 0) {
			throw new Error(`ffmpeg chunk failed at ${start}s for ${absPath}`);
		}

		chunks.push({
			chunkPath,
			sourceFile: absPath,
			startTime: start,
			endTime: end,
		});

		start += step;
		idx++;

		if (start + overlap >= duration) {
			break;
		}
	}

	return chunks;
}

export async function extractFrames(
	chunkPath: string,
	options: FrameOptions = {}
): Promise<Buffer[]> {
	const { count = 6 } = options;
	const tmpDir = join(tmpdir(), `indecks_frames_${Date.now()}`);
	await Bun.write(join(tmpDir, ".keep"), "");

	const duration = await getVideoDuration(chunkPath);
	const interval = duration / (count + 1);
	const frames: Buffer[] = [];

	for (let i = 1; i <= count; i++) {
		const timestamp = interval * i;
		const outPath = join(tmpDir, `frame_${String(i).padStart(3, "0")}.jpg`);

		await run("ffmpeg", [
			"-y",
			"-ss",
			String(timestamp),
			"-i",
			chunkPath,
			"-frames:v",
			"1",
			"-q:v",
			"2",
			outPath,
		]);

		const file = Bun.file(outPath);
		if (await file.exists()) {
			const buf = Buffer.from(await file.arrayBuffer());
			frames.push(buf);
		}
	}

	for (let i = 1; i <= count; i++) {
		const outPath = join(tmpDir, `frame_${String(i).padStart(3, "0")}.jpg`);
		await unlink(outPath).catch(() => {
			/* cleanup */
		});
	}
	await unlink(join(tmpDir, ".keep")).catch(() => {
		/* cleanup */
	});

	return frames;
}

export async function isStillFrame(
	chunkPath: string,
	threshold = 0.98
): Promise<boolean> {
	try {
		const tmpDir = join(tmpdir(), `indecks_still_${Date.now()}`);
		await Bun.write(join(tmpDir, ".keep"), "");

		const duration = await getVideoDuration(chunkPath);

		const t1 = duration * 0.25;
		const t2 = duration * 0.5;
		const t3 = duration * 0.75;

		for (const t of [t1, t2, t3]) {
			const idx = [t1, t2, t3].indexOf(t);
			await run("ffmpeg", [
				"-y",
				"-ss",
				String(t),
				"-i",
				chunkPath,
				"-frames:v",
				"1",
				join(tmpDir, `frame_${String(idx).padStart(3, "0")}.jpg`),
			]);
		}

		const sizes: number[] = [];
		for (let i = 0; i < 3; i++) {
			const framePath = join(tmpDir, `frame_${String(i).padStart(3, "0")}.jpg`);
			const file = Bun.file(framePath);
			if (await file.exists()) {
				sizes.push(file.size);
			}
			await unlink(framePath).catch(() => {
				/* cleanup */
			});
		}
		await unlink(join(tmpDir, ".keep")).catch(() => {
			/* cleanup */
		});

		if (sizes.length < 2) {
			return false;
		}

		const minSize = Math.min(...sizes);
		const maxSize = Math.max(...sizes);
		if (maxSize === 0) {
			return false;
		}

		return minSize / maxSize >= threshold;
	} catch {
		return false;
	}
}

export async function scanDirectory(dirPath: string): Promise<string[]> {
	const absDir = resolve(dirPath);
	const videos: string[] = [];

	async function walk(dir: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
			} else if (entry.isFile()) {
				const ext = entry.name.slice(entry.name.lastIndexOf(".")).toLowerCase();
				if (SUPPORTED_EXTENSIONS.has(ext)) {
					videos.push(fullPath);
				}
			}
		}
	}

	await walk(absDir);
	videos.sort();
	return videos;
}

export async function cleanupChunks(chunks: ChunkInfo[]): Promise<void> {
	for (const chunk of chunks) {
		await unlink(chunk.chunkPath).catch(() => {
			/* cleanup */
		});
	}
}

export type { ChunkInfo, ChunkOptions, FrameOptions };
