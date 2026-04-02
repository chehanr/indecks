import { Context, Effect, Layer } from "effect";

import { EmbeddingApiError, EmbeddingEmptyResponseError } from "./errors";

const TRAILING_SLASH = /\/$/;

export interface EmbedConfig {
	apiKey: string;
	baseUrl: string;
	dimensions: number;
	model: string;
}

interface EmbeddingResponse {
	data: Array<{
		embedding: number[];
		index: number;
	}>;
	model: string;
	usage: {
		prompt_tokens: number;
		total_tokens: number;
	};
}

const DEFAULT_VIDEO_INSTRUCTION = "Represent the visual content.";
const DEFAULT_TEXT_INSTRUCTION = "Represent the user's input.";

export interface EmbedServiceShape {
	readonly embedText: (
		text: string,
		config: EmbedConfig,
		instruction?: string
	) => Effect.Effect<number[], EmbeddingApiError | EmbeddingEmptyResponseError>;
	readonly embedVideo: (
		videoBuffer: Buffer,
		config: EmbedConfig,
		instruction?: string
	) => Effect.Effect<number[], EmbeddingApiError | EmbeddingEmptyResponseError>;
	readonly testConnection: (
		config: EmbedConfig
	) => Effect.Effect<{ ok: boolean; error?: string }>;
}

export class EmbedService extends Context.Tag("EmbedService")<
	EmbedService,
	EmbedServiceShape
>() {}

const callEmbeddingApi = (
	url: string,
	apiKey: string,
	body: unknown
): Effect.Effect<
	EmbeddingResponse,
	EmbeddingApiError | EmbeddingEmptyResponseError
> =>
	Effect.gen(function* () {
		const response = yield* Effect.tryPromise({
			try: () =>
				fetch(url, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${apiKey}`,
					},
					body: JSON.stringify(body),
				}),
			catch: (e) =>
				new EmbeddingApiError({
					statusCode: 0,
					body: `Fetch failed: ${e}`,
				}),
		});

		if (!response.ok) {
			const text = yield* Effect.tryPromise({
				try: () => response.text(),
				catch: () =>
					new EmbeddingApiError({
						statusCode: response.status,
						body: "Failed to read response body",
					}),
			});
			return yield* new EmbeddingApiError({
				statusCode: response.status,
				body: text,
			});
		}

		const result = yield* Effect.tryPromise({
			try: () => response.json() as Promise<EmbeddingResponse>,
			catch: (e) =>
				new EmbeddingApiError({
					statusCode: response.status,
					body: `Failed to parse JSON: ${e}`,
				}),
		});

		return result;
	});

export const EmbedServiceLive = Layer.succeed(EmbedService, {
	embedVideo: (videoBuffer, config, instruction) =>
		Effect.gen(function* () {
			const url = `${config.baseUrl.replace(TRAILING_SLASH, "")}/embeddings`;
			const base64 = videoBuffer.toString("base64");

			const result = yield* callEmbeddingApi(url, config.apiKey, {
				model: config.model,
				messages: [
					{
						role: "system",
						content: [
							{
								type: "text",
								text: instruction ?? DEFAULT_VIDEO_INSTRUCTION,
							},
						],
					},
					{
						role: "user",
						content: [
							{
								type: "video_url",
								video_url: { url: `data:video/mp4;base64,${base64}` },
							},
						],
					},
				],
				encoding_format: "float",
			});

			const [first] = result.data;
			if (!first) {
				return yield* new EmbeddingEmptyResponseError();
			}
			return first.embedding;
		}),

	embedText: (text, config, instruction) =>
		Effect.gen(function* () {
			const url = `${config.baseUrl.replace(TRAILING_SLASH, "")}/embeddings`;

			const result = yield* callEmbeddingApi(url, config.apiKey, {
				model: config.model,
				messages: [
					{
						role: "system",
						content: [
							{
								type: "text",
								text: instruction ?? DEFAULT_TEXT_INSTRUCTION,
							},
						],
					},
					{
						role: "user",
						content: [{ type: "text", text }],
					},
				],
				encoding_format: "float",
			});

			const [first] = result.data;
			if (!first) {
				return yield* new EmbeddingEmptyResponseError();
			}
			return first.embedding;
		}),

	testConnection: (config) => {
		const url = `${config.baseUrl.replace(TRAILING_SLASH, "")}/embeddings`;
		return callEmbeddingApi(url, config.apiKey, {
			model: config.model,
			messages: [
				{
					role: "system",
					content: [{ type: "text", text: DEFAULT_TEXT_INSTRUCTION }],
				},
				{
					role: "user",
					content: [{ type: "text", text: "test" }],
				},
			],
			encoding_format: "float",
		}).pipe(
			Effect.match({
				onSuccess: (res): { ok: boolean; error?: string } => {
					const [first] = res.data;
					if (!first) {
						return { ok: false, error: "No embedding data returned" };
					}
					if (first.embedding.length !== config.dimensions) {
						return {
							ok: false,
							error: `Expected ${config.dimensions} dimensions, got ${first.embedding.length}`,
						};
					}
					return { ok: true };
				},
				onFailure: (err): { ok: boolean; error?: string } => ({
					ok: false,
					error:
						err._tag === "EmbeddingApiError"
							? `${err._tag}: ${err.body}`
							: err._tag,
				}),
			})
		);
	},
});
