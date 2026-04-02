import { readdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Context, Effect, Layer } from "effect";

import { FFmpegError } from "./errors";

const SUPPORTED_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm"]);
const MP4_EXT = /\.mp4$/;

export interface ChunkInfo {
	chunkPath: string;
	endTime: number;
	sourceFile: string;
	startTime: number;
}

export interface ChunkOptions {
	chunkDuration?: number;
	overlap?: number;
}

export interface DownscaleOptions {
	fps?: number;
	height?: number;
}

const run = (
	cmd: string,
	args: string[]
): Effect.Effect<
	{ stdout: string; stderr: string; exitCode: number },
	FFmpegError
> =>
	Effect.tryPromise({
		try: async () => {
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
		},
		catch: (e) =>
			new FFmpegError({
				command: `${cmd} ${args.join(" ")}`,
				exitCode: -1,
				stderr: String(e),
			}),
	});

const getVideoDurationImpl = (
	filePath: string
): Effect.Effect<number, FFmpegError> =>
	Effect.gen(function* () {
		const { stdout, exitCode } = yield* run("ffprobe", [
			"-v",
			"quiet",
			"-print_format",
			"json",
			"-show_format",
			filePath,
		]);
		if (exitCode !== 0) {
			return yield* new FFmpegError({
				command: `ffprobe ${filePath}`,
				exitCode,
				stderr: "ffprobe failed",
			});
		}
		const info = JSON.parse(stdout) as {
			format: { duration: string };
		};
		return Number.parseFloat(info.format.duration);
	});

export interface FFmpegServiceShape {
	readonly chunkVideo: (
		filePath: string,
		options?: ChunkOptions
	) => Effect.Effect<ChunkInfo[], FFmpegError>;
	readonly cleanupChunks: (chunks: ChunkInfo[]) => Effect.Effect<void>;
	readonly downscaleChunk: (
		chunkPath: string,
		options?: DownscaleOptions
	) => Effect.Effect<string, FFmpegError>;
	readonly getVideoDuration: (
		filePath: string
	) => Effect.Effect<number, FFmpegError>;
	readonly isStillFrame: (
		chunkPath: string,
		threshold?: number
	) => Effect.Effect<boolean>;
	readonly scanDirectory: (dirPath: string) => Effect.Effect<string[]>;
}

export class FFmpegService extends Context.Tag("FFmpegService")<
	FFmpegService,
	FFmpegServiceShape
>() {}

export const FFmpegServiceLive = Layer.succeed(FFmpegService, {
	getVideoDuration: getVideoDurationImpl,

	chunkVideo: (filePath, options = {}) =>
		Effect.gen(function* () {
			const { chunkDuration = 30, overlap = 5 } = options;
			const absPath = resolve(filePath);
			const duration = yield* getVideoDurationImpl(absPath);
			const tmpDir = join(tmpdir(), `indecks_chunks_${Date.now()}`);
			yield* Effect.tryPromise({
				try: () => Bun.write(join(tmpDir, ".keep"), ""),
				catch: (e) =>
					new FFmpegError({
						command: "mkdir tmpdir",
						exitCode: -1,
						stderr: String(e),
					}),
			});

			const step = chunkDuration - overlap;
			const chunks: ChunkInfo[] = [];

			if (duration <= chunkDuration) {
				const chunkPath = join(tmpDir, "chunk_000.mp4");
				const { exitCode } = yield* run("ffmpeg", [
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
					return yield* new FFmpegError({
						command: `ffmpeg chunk ${absPath}`,
						exitCode,
						stderr: "chunk failed",
					});
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
				const chunkPath = join(
					tmpDir,
					`chunk_${String(idx).padStart(3, "0")}.mp4`
				);

				const { exitCode } = yield* run("ffmpeg", [
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
					return yield* new FFmpegError({
						command: `ffmpeg chunk at ${start}s`,
						exitCode,
						stderr: "chunk failed",
					});
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
		}),

	downscaleChunk: (chunkPath, options = {}) =>
		Effect.gen(function* () {
			const { height = 480, fps = 5 } = options;
			const outPath = chunkPath.replace(MP4_EXT, "_ds.mp4");

			const { exitCode, stderr } = yield* run("ffmpeg", [
				"-y",
				"-i",
				chunkPath,
				"-vf",
				`scale=-2:${height},fps=${fps}`,
				"-c:v",
				"libx264",
				"-preset",
				"ultrafast",
				"-an",
				outPath,
			]);

			if (exitCode !== 0) {
				return yield* new FFmpegError({
					command: "ffmpeg downscale",
					exitCode,
					stderr,
				});
			}

			return outPath;
		}),

	isStillFrame: (chunkPath, threshold = 0.98) =>
		Effect.gen(function* () {
			const tmpDir = join(tmpdir(), `indecks_still_${Date.now()}`);
			yield* Effect.tryPromise({
				try: () => Bun.write(join(tmpDir, ".keep"), ""),
				catch: () =>
					new FFmpegError({ command: "mkdir", exitCode: -1, stderr: "" }),
			}).pipe(Effect.ignore);

			const durationResult = yield* getVideoDurationImpl(chunkPath).pipe(
				Effect.option
			);

			if (durationResult._tag === "None") {
				return false;
			}
			const duration = durationResult.value;

			const times = [duration * 0.25, duration * 0.5, duration * 0.75];
			for (const [idx, t] of times.entries()) {
				yield* run("ffmpeg", [
					"-y",
					"-ss",
					String(t),
					"-i",
					chunkPath,
					"-frames:v",
					"1",
					join(tmpDir, `frame_${String(idx).padStart(3, "0")}.jpg`),
				]).pipe(Effect.ignore);
			}

			const sizes: number[] = [];
			for (let i = 0; i < 3; i++) {
				const framePath = join(
					tmpDir,
					`frame_${String(i).padStart(3, "0")}.jpg`
				);
				const file = Bun.file(framePath);
				const exists = yield* Effect.promise(() => file.exists());
				if (exists) {
					sizes.push(file.size);
				}
				yield* Effect.promise(() => unlink(framePath).catch(() => undefined));
			}
			yield* Effect.promise(() =>
				unlink(join(tmpDir, ".keep")).catch(() => undefined)
			);

			if (sizes.length < 2) {
				return false;
			}

			const minSize = Math.min(...sizes);
			const maxSize = Math.max(...sizes);
			if (maxSize === 0) {
				return false;
			}

			return minSize / maxSize >= threshold;
		}),

	scanDirectory: (dirPath) =>
		Effect.tryPromise({
			try: async () => {
				const absDir = resolve(dirPath);
				const videos: string[] = [];

				const walk = async (dir: string): Promise<void> => {
					const entries = await readdir(dir, { withFileTypes: true });
					for (const entry of entries) {
						const fullPath = join(dir, entry.name);
						if (entry.isDirectory()) {
							await walk(fullPath);
						} else if (entry.isFile()) {
							const ext = entry.name
								.slice(entry.name.lastIndexOf("."))
								.toLowerCase();
							if (SUPPORTED_EXTENSIONS.has(ext)) {
								videos.push(fullPath);
							}
						}
					}
				};

				await walk(absDir);
				videos.sort();
				return videos;
			},
			catch: () =>
				new FFmpegError({
					command: "scanDirectory",
					exitCode: -1,
					stderr: "scan failed",
				}),
		}).pipe(Effect.catchAll(() => Effect.succeed([] as string[]))),

	cleanupChunks: (chunks) =>
		Effect.promise(async () => {
			for (const chunk of chunks) {
				await unlink(chunk.chunkPath).catch(() => undefined);
			}
		}),
});
