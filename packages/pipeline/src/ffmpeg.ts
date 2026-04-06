import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { Context, Duration, Effect, Layer, Queue } from "effect";

import { FFmpegError } from "./errors";

const MP4_EXT = /\.mp4$/;
const FREEZE_DURATION_RE = /freeze_duration:\s*([\d.]+)/;
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
	args: string[]
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
	readonly getVideoDuration: (
		filePath: string
	) => Effect.Effect<number, FFmpegError>;
	readonly isStillFrame: (
		chunkPath: string,
		duration: number,
		threshold?: number
	) => Effect.Effect<boolean>;
	readonly scanDirectory: (
		dirPath: string,
		excludePatterns?: string[]
	) => Effect.Effect<string[]>;
}

export class FFmpegService extends Context.Tag("FFmpegService")<
	FFmpegService,
	FFmpegServiceShape
>() {}

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
						concurrency: chunkConcurrency,
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

					const step = chunkDuration - overlap;

					const makeChunk = (start: number, t: number, chunkPath: string) =>
						runExitCode(executor, "ffmpeg", [
							"-y",
							"-ss",
							String(start),
							"-i",
							absPath,
							"-t",
							String(t),
							...codecArgs,
							chunkPath,
						]);

					// Precompute all chunk specs
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
					} else {
						let start = 0;
						let idx = 0;
						while (start < duration) {
							const end = Math.min(start + chunkDuration, duration);
							specs.push({
								startTime: start,
								endTime: end,
								t: end - start,
								chunkPath: join(
									tmpDir,
									`chunk_${String(idx).padStart(3, "0")}.mp4`
								),
							});
							start += step;
							idx++;
							if (start + overlap >= duration) {
								break;
							}
						}
					}

					// Run ffmpeg in parallel
					yield* Effect.forEach(
						specs,
						(spec) => makeChunk(spec.startTime, spec.t, spec.chunkPath),
						{ concurrency: chunkConcurrency }
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

					const step = chunkDuration - overlap;

					// Precompute chunk specs to know total count upfront
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
					} else {
						let start = 0;
						let idx = 0;
						while (start < duration) {
							const end = Math.min(start + chunkDuration, duration);
							specs.push({
								startTime: start,
								endTime: end,
								t: end - start,
								chunkPath: join(
									tmpDir,
									`chunk_${String(idx).padStart(3, "0")}.mp4`
								),
							});
							start += step;
							idx++;
							if (start + overlap >= duration) {
								break;
							}
						}
					}

					// Return total count and a produce effect that creates chunks sequentially
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
						{ discard: true }
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

			isStillFrame: (chunkPath, duration, threshold = 0.98) =>
				Effect.gen(function* () {
					if (duration < 0.5) {
						return false;
					}

					// Single-pass freeze detection via ffmpeg filter
					const output = yield* runString(executor, "ffmpeg", [
						"-i",
						chunkPath,
						"-vf",
						"freezedetect=n=0.003:d=0.5",
						"-f",
						"null",
						"-",
					]).pipe(Effect.catchAll(() => Effect.succeed("")));

					// freezedetect outputs freeze_duration in stderr/stdout
					// If freeze covers >= threshold of total duration, it's a still frame
					const match = FREEZE_DURATION_RE.exec(output);
					if (!match?.[1]) {
						return false;
					}
					const freezeDuration = Number.parseFloat(match[1]);
					return freezeDuration / duration >= threshold;
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
