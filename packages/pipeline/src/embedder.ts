const TRAILING_SLASH = /\/$/;

interface EmbedConfig {
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

export async function embedVideo(
	videoBuffer: Buffer,
	config: EmbedConfig,
	instruction?: string
): Promise<number[]> {
	const url = `${config.baseUrl.replace(TRAILING_SLASH, "")}/v1/embeddings`;
	const base64 = videoBuffer.toString("base64");

	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${config.apiKey}`,
		},
		body: JSON.stringify({
			model: config.model,
			messages: [
				{
					role: "system",
					content: [
						{
							type: "text",
							text: instruction || DEFAULT_VIDEO_INSTRUCTION,
						},
					],
				},
				{
					role: "user",
					content: [
						{
							type: "video_url",
							video_url: {
								url: `data:video/mp4;base64,${base64}`,
							},
						},
					],
				},
			],
			encoding_format: "float",
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Embedding API error (${response.status}): ${body}`);
	}

	const result = (await response.json()) as EmbeddingResponse;
	const [first] = result.data;
	if (!first) {
		throw new Error("Embedding API returned no data");
	}
	return first.embedding;
}

export async function embedText(
	text: string,
	config: EmbedConfig,
	instruction?: string
): Promise<number[]> {
	const url = `${config.baseUrl.replace(TRAILING_SLASH, "")}/v1/embeddings`;
	const response = await fetch(url, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${config.apiKey}`,
		},
		body: JSON.stringify({
			model: config.model,
			messages: [
				{
					role: "system",
					content: [
						{
							type: "text",
							text: instruction || DEFAULT_TEXT_INSTRUCTION,
						},
					],
				},
				{
					role: "user",
					content: [{ type: "text", text }],
				},
			],
			encoding_format: "float",
		}),
	});

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Embedding API error (${response.status}): ${body}`);
	}

	const result = (await response.json()) as EmbeddingResponse;
	const [first] = result.data;
	if (!first) {
		throw new Error("Embedding API returned no data");
	}
	return first.embedding;
}

export async function testConnection(
	config: EmbedConfig
): Promise<{ ok: boolean; error?: string }> {
	try {
		const embedding = await embedText("test", config);
		if (embedding.length !== config.dimensions) {
			return {
				ok: false,
				error: `Expected ${config.dimensions} dimensions, got ${embedding.length}`,
			};
		}
		return { ok: true };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export type { EmbedConfig };
