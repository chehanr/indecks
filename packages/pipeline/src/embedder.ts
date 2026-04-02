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

function averageAndNormalize(embeddings: number[][]): number[] {
	const dim = embeddings[0]?.length ?? 0;
	const count = embeddings.length;
	const avg = new Array<number>(dim).fill(0);

	for (const emb of embeddings) {
		emb.forEach((val, i) => {
			avg[i] = (avg[i] ?? 0) + val;
		});
	}

	const scaled = avg.map((v) => v / count);
	const norm = Math.sqrt(scaled.reduce((sum, v) => sum + v * v, 0));
	if (norm === 0) {
		return scaled;
	}
	return scaled.map((v) => v / norm);
}

export async function embedFrames(
	frames: Buffer[],
	config: EmbedConfig
): Promise<number[]> {
	const url = `${config.baseUrl.replace(TRAILING_SLASH, "")}/v1/embeddings`;

	const embeddings: number[][] = [];

	for (const frame of frames) {
		const base64 = frame.toString("base64");
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
						content: [{ type: "text", text: "Represent the visual content." }],
					},
					{
						role: "user",
						content: [
							{
								type: "image_url",
								image_url: {
									url: `data:image/jpeg;base64,${base64}`,
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
		embeddings.push(first.embedding);
	}

	if (embeddings.length === 0) {
		throw new Error("No frames to embed");
	}

	if (embeddings.length === 1) {
		return embeddings[0] as number[];
	}

	return averageAndNormalize(embeddings);
}

export async function embedText(
	text: string,
	config: EmbedConfig
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
					content: [{ type: "text", text: "Represent the user's input." }],
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
