import { Button } from "@indecks/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@indecks/ui/components/card";
import { Input } from "@indecks/ui/components/input";
import { Label } from "@indecks/ui/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { queryClient, trpc, trpcClient } from "@/utils/trpc";

export const Route = createFileRoute("/settings")({
	component: SettingsPage,
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data) {
			redirect({ to: "/login", throw: true });
		}
	},
});

function EmbeddingConfigForm() {
	const [baseUrl, setBaseUrl] = useState("");
	const [apiKey, setApiKey] = useState("");
	const [model, setModel] = useState("");
	const [dimensions, setDimensions] = useState(768);

	const settingsQuery = useQuery(trpc.settings.get.queryOptions());

	useEffect(() => {
		if (settingsQuery.data) {
			setBaseUrl(settingsQuery.data.embeddingBaseUrl);
			setApiKey(settingsQuery.data.embeddingApiKey);
			setModel(settingsQuery.data.embeddingModel);
			setDimensions(settingsQuery.data.embeddingDimensions);
		}
	}, [settingsQuery.data]);

	const saveMutation = useMutation({
		mutationFn: (input: {
			embeddingBaseUrl: string;
			embeddingApiKey: string;
			embeddingModel: string;
			embeddingDimensions: number;
		}) => trpcClient.settings.update.mutate(input),
		onSuccess: () => {
			toast.success("Settings saved");
			queryClient.invalidateQueries({ queryKey: [["settings", "get"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const testMutation = useMutation({
		mutationFn: (input: {
			embeddingBaseUrl: string;
			embeddingApiKey: string;
			embeddingModel: string;
			embeddingDimensions: number;
		}) => trpcClient.settings.test.mutate(input),
		onSuccess: (data) => {
			if (data.ok) {
				toast.success("Connection successful");
			} else {
				toast.error(data.error ?? "Connection failed");
			}
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const formValues = {
		embeddingBaseUrl: baseUrl,
		embeddingApiKey: apiKey,
		embeddingModel: model,
		embeddingDimensions: dimensions,
	};

	const canSubmit = baseUrl.trim() && model.trim();

	return (
		<Card>
			<CardHeader>
				<CardTitle>Embedding API</CardTitle>
				<CardDescription>
					Configure the OpenAI-compatible embedding API endpoint (vLLM, Ollama,
					LiteLLM, etc.)
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="flex flex-col gap-4"
					onSubmit={(e) => {
						e.preventDefault();
						saveMutation.mutate(formValues);
					}}
				>
					<div className="flex flex-col gap-2">
						<Label htmlFor="baseUrl">Base URL</Label>
						<Input
							id="baseUrl"
							onChange={(e) => setBaseUrl(e.target.value)}
							placeholder="http://localhost:8000/v1"
							value={baseUrl}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="apiKey">API Key</Label>
						<Input
							id="apiKey"
							onChange={(e) => setApiKey(e.target.value)}
							placeholder="Optional"
							type="password"
							value={apiKey}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="model">Model</Label>
						<Input
							id="model"
							onChange={(e) => setModel(e.target.value)}
							placeholder="Qwen/Qwen3-Embedding-0.6B"
							value={model}
						/>
					</div>
					<div className="flex flex-col gap-2">
						<Label htmlFor="dimensions">Dimensions</Label>
						<Input
							id="dimensions"
							min={1}
							onChange={(e) =>
								setDimensions(Number.parseInt(e.target.value, 10) || 768)
							}
							type="number"
							value={dimensions}
						/>
					</div>
					<div className="flex gap-2">
						<Button
							disabled={!canSubmit || saveMutation.isPending}
							type="submit"
						>
							{saveMutation.isPending ? "Saving..." : "Save"}
						</Button>
						<Button
							disabled={!canSubmit || testMutation.isPending}
							onClick={() => testMutation.mutate(formValues)}
							type="button"
							variant="outline"
						>
							{testMutation.isPending ? "Testing..." : "Test Connection"}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

function SettingsPage() {
	return (
		<div className="container mx-auto max-w-3xl space-y-6 px-4 py-6">
			<h1 className="font-bold text-2xl">Settings</h1>
			<EmbeddingConfigForm />
		</div>
	);
}
