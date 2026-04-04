import { HttpClient, HttpClientRequest } from "@effect/platform";
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
	client: HttpClient.HttpClient,
	url: string,
	apiKey: string,
	body: unknown
): Effect.Effect<
	EmbeddingResponse,
	EmbeddingApiError | EmbeddingEmptyResponseError
> =>
	Effect.gen(function* () {
		const request = HttpClientRequest.post(url).pipe(
			HttpClientRequest.setHeader("Content-Type", "application/json"),
			HttpClientRequest.setHeader("Authorization", `Bearer ${apiKey}`),
			HttpClientRequest.bodyUnsafeJson(body)
		);

		const response = yield* client.execute(request).pipe(
			Effect.catchAll((e) =>
				Effect.fail(
					new EmbeddingApiError({
						statusCode: 0,
						body: `Request failed: ${e}`,
					})
				)
			)
		);

		if (response.status >= 400) {
			const text = yield* response.text.pipe(
				Effect.catchAll((err) =>
					Effect.logWarning(`Failed to read error response body: ${err}`).pipe(
						Effect.as("Failed to read response body")
					)
				)
			);
			return yield* new EmbeddingApiError({
				statusCode: response.status,
				body: text,
			});
		}

		const result = yield* response.json.pipe(
			Effect.catchAll((e) =>
				Effect.fail(
					new EmbeddingApiError({
						statusCode: response.status,
						body: `Failed to parse JSON: ${e}`,
					})
				)
			)
		);

		return result as EmbeddingResponse;
	});

export const EmbedServiceLive = Layer.effect(
	EmbedService,
	Effect.gen(function* () {
		const client = yield* HttpClient.HttpClient;

		return {
			embedVideo: (videoBuffer, config, instruction) =>
				Effect.gen(function* () {
					const url = `${config.baseUrl.replace(TRAILING_SLASH, "")}/embeddings`;
					const base64 = videoBuffer.toString("base64");

					const result = yield* callEmbeddingApi(client, url, config.apiKey, {
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

					const result = yield* callEmbeddingApi(client, url, config.apiKey, {
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
				return callEmbeddingApi(client, url, config.apiKey, {
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
		};
	})
);
