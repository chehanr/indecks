import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { Command, CommandExecutor, FileSystem } from "@effect/platform";
import { Context, Effect, Layer } from "effect";

import { FFmpegError } from "./errors";

const MP4_EXT = /\.mp4$/;
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm"]);

const findVideos = (dir: string): Effect.Effect<string[]> =>
	Effect.promise(async () => {
		const entries = await readdir(dir, { recursive: true });
		return entries
			.filter((entry) => {
				const ext = entry.slice(entry.lastIndexOf(".")).toLowerCase();
				return VIDEO_EXTENSIONS.has(ext);
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
	overlap?: number;
}

export interface DownscaleOptions {
	fps?: number;
	height?: number;
}

const runString = (
	executor: CommandExecutor.CommandExecutor,
	cmd: string,
	args: string[]
): Effect.Effect<string, FFmpegError> =>
	Command.make(cmd, ...args).pipe(
		Command.string,
		Effect.provideService(CommandExecutor.CommandExecutor, executor),
		Effect.catchAll((e) =>
			Effect.fail(
				new FFmpegError({
					command: `${cmd} ${args.join(" ")}`,
					exitCode: -1,
					stderr: String(e),
				})
			)
		)
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

export const FFmpegServiceLive = Layer.effect(
	FFmpegService,
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const executor = yield* CommandExecutor.CommandExecutor;

		return {
			getVideoDuration: (filePath) => getVideoDuration(executor, filePath),

			chunkVideo: (filePath, options = {}) =>
				Effect.gen(function* () {
					const { chunkDuration = 30, overlap = 5 } = options;
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

					const step = chunkDuration - overlap;
					const chunks: ChunkInfo[] = [];

					if (duration <= chunkDuration) {
						const chunkPath = join(tmpDir, "chunk_000.mp4");
						yield* runExitCode(executor, "ffmpeg", [
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

						yield* runExitCode(executor, "ffmpeg", [
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

			isStillFrame: (chunkPath, threshold = 0.98) =>
				Effect.gen(function* () {
					const tmpDir = join(tmpdir(), `indecks_still_${Date.now()}`);
					yield* fs
						.makeDirectory(tmpDir, { recursive: true })
						.pipe(Effect.ignore);

					const durationResult = yield* getVideoDuration(
						executor,
						chunkPath
					).pipe(Effect.option);

					if (durationResult._tag === "None") {
						return false;
					}
					const duration = durationResult.value;

					const times = [duration * 0.25, duration * 0.5, duration * 0.75];

					// Extract frames in parallel
					yield* Effect.forEach(
						times,
						(t, idx) =>
							runExitCode(executor, "ffmpeg", [
								"-y",
								"-ss",
								String(t),
								"-i",
								chunkPath,
								"-frames:v",
								"1",
								join(tmpDir, `frame_${String(idx).padStart(3, "0")}.jpg`),
							]).pipe(Effect.ignore),
						{ concurrency: 3 }
					);

					const sizes: number[] = [];
					for (let i = 0; i < 3; i++) {
						const framePath = join(
							tmpDir,
							`frame_${String(i).padStart(3, "0")}.jpg`
						);
						const exists = yield* fs
							.exists(framePath)
							.pipe(Effect.orElseSucceed(() => false));
						if (exists) {
							const info = yield* fs.stat(framePath).pipe(Effect.option);
							if (info._tag === "Some") {
								sizes.push(Number(info.value.size));
							}
						}
						yield* fs.remove(framePath).pipe(Effect.ignore);
					}
					yield* fs.remove(tmpDir, { recursive: true }).pipe(Effect.ignore);

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
				Effect.gen(function* () {
					const absDir = resolve(dirPath);
					const videos = yield* findVideos(absDir);
					videos.sort();
					return videos;
				}).pipe(Effect.catchAll(() => Effect.succeed([] as string[]))),

			cleanupChunks: (chunks) =>
				Effect.forEach(
					chunks,
					(chunk) => fs.remove(chunk.chunkPath).pipe(Effect.ignore),
					{ discard: true }
				),
		};
	})
);
