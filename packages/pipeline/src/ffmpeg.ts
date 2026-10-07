import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { Context, Duration, Effect, Layer, Queue } from "effect";

import { FFmpegError } from "./errors";

const MP4_EXT = /\.mp4$/;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm"]);

const findVideos = (
	dir: string,
	excludePatterns: string[] = []
): Effect.Effect<string[]> =>
	Effect.promise(async () => {
		const regexes = excludePatterns.map((p) => new RegExp(p));
		const entries = await readdir(dir, { recursive: true });
		return entries
			.filter((entry) => {
				const ext = entry.slice(entry.lastIndexOf(".")).toLowerCase();
				if (!VIDEO_EXTENSIONS.has(ext)) {
					return false;
				}
				if (regexes.some((re) => re.test(entry))) {
					return false;
				}
				return true;
			})
			.map((entry) => join(dir, entry));
	});

export interface ChunkInfo {
	chunkPath: string;
	endTime: number;
	sourceFile: string;
	startTime: number;
}

export interface ChunkOptions {
	chunkDuration?: number;
	concurrency: number;
	downscaleFps?: number;
	downscaleHeight?: number;
	overlap?: number;
}

export interface DownscaleOptions {
	fps?: number;
	height?: number;
}

const CMD_TIMEOUT = Duration.minutes(2);

const runString = (
	executor: CommandExecutor.CommandExecutor,
	cmd: string,
	args: string[]
): Effect.Effect<string, FFmpegError> =>
	Command.make(cmd, ...args).pipe(
		Command.string,
		Effect.provideService(CommandExecutor.CommandExecutor, executor),
		Effect.timeoutFail({
			duration: CMD_TIMEOUT,
			onTimeout: () =>
				new FFmpegError({
					command: `${cmd} ${args.join(" ")}`,
					exitCode: -1,
					stderr: "Command timed out",
				}),
		}),
		Effect.catchAll((e) => {
			if (e instanceof FFmpegError) {
				return Effect.fail(e);
			}
			return Effect.fail(
				new FFmpegError({
					command: `${cmd} ${args.join(" ")}`,
					exitCode: -1,
					stderr: String(e),
				})
			);
		})
	);

const runExitCode = (
	executor: CommandExecutor.CommandExecutor,
	cmd: string,
	args: string[],
	timeout: Duration.Duration = CMD_TIMEOUT
): Effect.Effect<void, FFmpegError> =>
	Command.make(cmd, ...args).pipe(
		Command.exitCode,
		Effect.provideService(CommandExecutor.CommandExecutor, executor),
		Effect.flatMap((code) =>
			code === 0
				? Effect.void
				: Effect.fail(
						new FFmpegError({
							command: `${cmd} ${args.join(" ")}`,
							exitCode: code,
							stderr: "",
						})
					)
		),
		Effect.timeoutFail({
			duration: timeout,
			onTimeout: () =>
				new FFmpegError({
					command: `${cmd} ${args.join(" ")}`,
					exitCode: -1,
					stderr: "Command timed out",
				}),
		}),
		Effect.catchAll((e) => {
			if (e instanceof FFmpegError) {
				return Effect.fail(e);
			}
			return Effect.fail(
				new FFmpegError({
					command: `${cmd} ${args.join(" ")}`,
					exitCode: -1,
					stderr: String(e),
				})
			);
		})
	);

const getVideoDuration = (
	executor: CommandExecutor.CommandExecutor,
	filePath: string
): Effect.Effect<number, FFmpegError> =>
	Effect.gen(function* () {
		const stdout = yield* runString(executor, "ffprobe", [
			"-v",
			"quiet",
			"-print_format",
			"json",
			"-show_format",
			filePath,
		]);
		const info = JSON.parse(stdout) as {
			format?: { duration?: string };
		};
		const raw = info.format?.duration;
		if (raw === undefined) {
			return yield* Effect.fail(
				new FFmpegError({
					command: `ffprobe ${filePath}`,
					exitCode: -1,
					stderr: "No duration in format info",
				})
			);
		}
		return Number.parseFloat(raw);
	});

export interface FFmpegServiceShape {
	readonly chunkVideo: (
		filePath: string,
		options: ChunkOptions
	) => Effect.Effect<ChunkInfo[], FFmpegError>;
	readonly chunkVideoStreamed: (
		filePath: string,
		options: ChunkOptions,
		queue: Queue.Queue<ChunkInfo | null>
	) => Effect.Effect<
		{
			produce: Effect.Effect<void, FFmpegError>;
			tmpDir: string;
			total: number;
		},
		FFmpegError
	>;
	readonly cleanupChunks: (chunks: ChunkInfo[]) => Effect.Effect<void>;
	readonly downscaleChunk: (
		chunkPath: string,
		options?: DownscaleOptions
	) => Effect.Effect<string, FFmpegError>;
	readonly extractChunkFrames: (
		chunkPath: string,
		fps: number
	) => Effect.Effect<Buffer[], FFmpegError>;
	readonly getVideoDuration: (
		filePath: string
	) => Effect.Effect<number, FFmpegError>;
	readonly scanDirectory: (
		dirPath: string,
		excludePatterns?: string[]
	) => Effect.Effect<string[]>;
}

export class FFmpegService extends Context.Tag("FFmpegService")<
	FFmpegService,
	FFmpegServiceShape
>() {}

const computeChunkSpecs = (
	duration: number,
	chunkDuration: number,
	overlap: number,
	tmpDir: string
): Array<{
	chunkPath: string;
	endTime: number;
	startTime: number;
	t: number;
}> => {
	const step = chunkDuration - overlap;
	const specs: Array<{
		chunkPath: string;
		endTime: number;
		startTime: number;
		t: number;
	}> = [];

	if (duration <= chunkDuration) {
		specs.push({
			startTime: 0,
			endTime: duration,
			t: duration,
			chunkPath: join(tmpDir, "chunk_000.mp4"),
		});
		return specs;
	}

	let start = 0;
	let idx = 0;
	while (start < duration) {
		const end = Math.min(start + chunkDuration, duration);
		specs.push({
			startTime: start,
			endTime: end,
			t: end - start,
			chunkPath: join(tmpDir, `chunk_${String(idx).padStart(3, "0")}.mp4`),
		});
		start += step;
		idx++;
		if (start + overlap >= duration) {
			break;
		}
	}

	return specs;
};

export const FFmpegServiceLive = Layer.effect(
	FFmpegService,
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const executor = yield* CommandExecutor.CommandExecutor;

		return {
			getVideoDuration: (filePath) => getVideoDuration(executor, filePath),

			chunkVideo: (filePath, options) =>
				Effect.gen(function* () {
					const {
						chunkDuration = 30,
						overlap = 5,
						downscaleHeight,
						downscaleFps,
					} = options;
					const absPath = resolve(filePath);
					const duration = yield* getVideoDuration(executor, absPath);
					const tmpDir = join(tmpdir(), `indecks_chunks_${Date.now()}`);
					yield* fs.makeDirectory(tmpDir, { recursive: true }).pipe(
						Effect.mapError(
							(e) =>
								new FFmpegError({
									command: "mkdir tmpdir",
									exitCode: -1,
									stderr: String(e),
								})
						)
					);

					const useDownscale = downscaleHeight || downscaleFps;
					const codecArgs: string[] = useDownscale
						? [
								"-vf",
								`scale=-2:${downscaleHeight ?? 480},fps=${downscaleFps ?? 5}`,
								"-c:v",
								"libx264",
								"-preset",
								"ultrafast",
								"-an",
							]
						: ["-c", "copy"];

					const specs = computeChunkSpecs(
						duration,
						chunkDuration,
						overlap,
						tmpDir
					);

					yield* Effect.forEach(
						specs,
						(spec) =>
							runExitCode(executor, "ffmpeg", [
								"-y",
								"-ss",
								String(spec.startTime),
								"-i",
								absPath,
								"-t",
								String(spec.t),
								...codecArgs,
								spec.chunkPath,
							]),
						{ concurrency: 2 }
					);

					return specs.map((spec) => ({
						chunkPath: spec.chunkPath,
						sourceFile: absPath,
						startTime: spec.startTime,
						endTime: spec.endTime,
					}));
				}),

			chunkVideoStreamed: (filePath, options, queue) =>
				Effect.gen(function* () {
					const {
						chunkDuration = 30,
						overlap = 5,
						downscaleHeight,
						downscaleFps,
					} = options;
					const absPath = resolve(filePath);
					const duration = yield* getVideoDuration(executor, absPath);
					const tmpDir = join(tmpdir(), `indecks_chunks_${Date.now()}`);
					yield* fs.makeDirectory(tmpDir, { recursive: true }).pipe(
						Effect.mapError(
							(e) =>
								new FFmpegError({
									command: "mkdir tmpdir",
									exitCode: -1,
									stderr: String(e),
								})
						)
					);

					const useDownscale = downscaleHeight || downscaleFps;
					const codecArgs: string[] = useDownscale
						? [
								"-vf",
								`scale=-2:${downscaleHeight ?? 480},fps=${downscaleFps ?? 5}`,
								"-c:v",
								"libx264",
								"-preset",
								"ultrafast",
								"-an",
							]
						: ["-c", "copy"];

					const specs = computeChunkSpecs(
						duration,
						chunkDuration,
						overlap,
						tmpDir
					);

					const produce = Effect.forEach(
						specs,
						(spec) =>
							runExitCode(executor, "ffmpeg", [
								"-y",
								"-ss",
								String(spec.startTime),
								"-i",
								absPath,
								"-t",
								String(spec.t),
								...codecArgs,
								spec.chunkPath,
							]).pipe(
								Effect.flatMap(() =>
									Queue.offer(queue, {
										chunkPath: spec.chunkPath,
										sourceFile: absPath,
										startTime: spec.startTime,
										endTime: spec.endTime,
									})
								)
							),
						{ concurrency: 2, discard: true }
					);

					return { total: specs.length, produce, tmpDir };
				}),

			downscaleChunk: (chunkPath, options = {}) =>
				Effect.gen(function* () {
					const { height = 480, fps = 5 } = options;
					const outPath = chunkPath.replace(MP4_EXT, "_ds.mp4");

					yield* runExitCode(executor, "ffmpeg", [
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

					return outPath;
				}),

			extractChunkFrames: (chunkPath, fps) =>
				Effect.gen(function* () {
					const framesDir = join(
						tmpdir(),
						`indecks_frames_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
					);
					yield* fs.makeDirectory(framesDir, { recursive: true }).pipe(
						Effect.mapError(
							(e) =>
								new FFmpegError({
									command: "mkdir frames tmpdir",
									exitCode: -1,
									stderr: String(e),
								})
						)
					);

					yield* runExitCode(executor, "ffmpeg", [
						"-y",
						"-i",
						chunkPath,
						"-vf",
						`fps=${fps}`,
						"-q:v",
						"5",
						join(framesDir, "frame_%04d.jpg"),
					]);

					const names = yield* fs.readDirectory(framesDir).pipe(
						Effect.mapError(
							(e) =>
								new FFmpegError({
									command: "readdir frames",
									exitCode: -1,
									stderr: String(e),
								})
						)
					);
					names.sort();

					const frames: Buffer[] = [];
					for (const name of names) {
						const bytes = yield* fs.readFile(join(framesDir, name)).pipe(
							Effect.mapError(
								(e) =>
									new FFmpegError({
										command: "read frame",
										exitCode: -1,
										stderr: String(e),
									})
							)
						);
						frames.push(Buffer.from(bytes));
					}

					yield* fs
						.remove(framesDir, { recursive: true, force: true })
						.pipe(Effect.ignore);
					return frames;
				}),

			scanDirectory: (dirPath, excludePatterns) =>
				Effect.gen(function* () {
					const absDir = resolve(dirPath);
					const videos = yield* findVideos(absDir, excludePatterns);
					videos.sort();
					return videos;
				}).pipe(
					Effect.catchAll((err) =>
						Effect.logError(
							`Directory scan failed for ${dirPath}: ${err}`
						).pipe(Effect.as([] as string[]))
					)
				),

			cleanupChunks: (chunks) =>
				Effect.forEach(
					chunks,
					(chunk) => fs.remove(chunk.chunkPath).pipe(Effect.ignore),
					{ discard: true }
				),
		};
	})
);
