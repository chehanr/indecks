import { Button } from "@indecks/ui/components/button";
import { Field, FieldGroup, FieldLabel } from "@indecks/ui/components/field";
import { Input } from "@indecks/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { queryClient, trpcClient } from "@/utils/trpc";

export function EditLibraryForm({
	library,
}: {
	library: {
		id: string;
		name: string;
		folderPaths: string;
		scanConcurrency: number;
	};
}) {
	const [name, setName] = useState(library.name);
	const [folderPaths, setFolderPaths] = useState<string[]>(() =>
		JSON.parse(library.folderPaths)
	);
	const [scanConcurrency, setScanConcurrency] = useState(
		library.scanConcurrency
	);

	const updateMutation = useMutation({
		mutationFn: () =>
			trpcClient.library.update.mutate({
				id: library.id,
				name,
				folderPaths: folderPaths.filter((p) => p.trim()),
				scanConcurrency,
			}),
		onSuccess: () => {
			toast.success("Library updated");
			queryClient.invalidateQueries({ queryKey: [["library", "get"]] });
			queryClient.invalidateQueries({ queryKey: [["library", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const validPaths = folderPaths.filter((p) => p.trim());
	const canSubmit = name.trim() !== "" && validPaths.length > 0;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				if (canSubmit) {
					updateMutation.mutate();
				}
			}}
		>
			<FieldGroup>
				<Field>
					<FieldLabel htmlFor="edit-lib-name">Name</FieldLabel>
					<Input
						id="edit-lib-name"
						onChange={(e) => setName(e.target.value)}
						value={name}
					/>
				</Field>
				<Field>
					<FieldLabel>Folder Paths</FieldLabel>
					<div className="space-y-2">
						{folderPaths.map((path, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: editable input list
							<div className="flex gap-2" key={i}>
								<Input
									onChange={(e) => {
										const next = [...folderPaths];
										next[i] = e.target.value;
										setFolderPaths(next);
									}}
									placeholder="/path/to/videos"
									value={path}
								/>
								{folderPaths.length > 1 && (
									<Button
										onClick={() =>
											setFolderPaths(folderPaths.filter((_, j) => j !== i))
										}
										size="icon"
										type="button"
										variant="ghost"
									>
										<Trash2 className="size-4" />
									</Button>
								)}
							</div>
						))}
						<Button
							onClick={() => setFolderPaths([...folderPaths, ""])}
							size="sm"
							type="button"
							variant="outline"
						>
							<Plus className="size-4" />
							Add Path
						</Button>
					</div>
				</Field>
				<Field>
					<FieldLabel htmlFor="edit-lib-scanConcurrency">
						Scan Concurrency
					</FieldLabel>
					<Input
						id="edit-lib-scanConcurrency"
						max={16}
						min={1}
						onChange={(e) =>
							setScanConcurrency(Number.parseInt(e.target.value, 10) || 3)
						}
						type="number"
						value={scanConcurrency}
					/>
				</Field>
				<Button
					className="w-fit"
					disabled={!canSubmit || updateMutation.isPending}
					type="submit"
				>
					{updateMutation.isPending ? "Saving..." : "Save"}
				</Button>
			</FieldGroup>
		</form>
	);
}
