import { Button } from "@indecks/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@indecks/ui/components/dialog";
import { Field, FieldGroup, FieldLabel } from "@indecks/ui/components/field";
import { Input } from "@indecks/ui/components/input";
import { useMutation } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { queryClient, trpcClient } from "@/utils/trpc";

export function CreateLibraryDialog() {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [folderPaths, setFolderPaths] = useState([""]);
	const [excludePatterns, setExcludePatterns] = useState<string[]>([]);

	const createMutation = useMutation({
		mutationFn: (input: {
			name: string;
			folderPaths: string[];
			excludePatterns: string[];
		}) => trpcClient.library.create.mutate(input),
		onSuccess: () => {
			toast.success("Library created");
			setName("");
			setFolderPaths([""]);
			setExcludePatterns([]);
			setOpen(false);
			queryClient.invalidateQueries({ queryKey: [["library", "list"]] });
		},
		onError: (err) => {
			toast.error(err.message);
		},
	});

	const validPaths = folderPaths.filter((p) => p.trim());
	const canSubmit = name.trim() && validPaths.length > 0;

	return (
		<Dialog onOpenChange={setOpen} open={open}>
			<DialogTrigger
				render={
					<Button size="sm">
						<Plus className="size-4" />
						New Library
					</Button>
				}
			/>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Create Library</DialogTitle>
					<DialogDescription>
						Point to one or more folders containing video files.
					</DialogDescription>
				</DialogHeader>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						if (canSubmit) {
							createMutation.mutate({
								name,
								folderPaths: validPaths,
								excludePatterns: excludePatterns.filter((p) => p.trim()),
							});
						}
					}}
				>
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="lib-name">Name</FieldLabel>
							<Input
								id="lib-name"
								onChange={(e) => setName(e.target.value)}
								placeholder="My Videos"
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
							<FieldLabel>Exclude Patterns</FieldLabel>
							<div className="space-y-2">
								{excludePatterns.map((pattern, i) => (
									// biome-ignore lint/suspicious/noArrayIndexKey: editable input list
									<div className="flex gap-2" key={i}>
										<Input
											onChange={(e) => {
												const next = [...excludePatterns];
												next[i] = e.target.value;
												setExcludePatterns(next);
											}}
											placeholder="e.g. ^_ or \.DS_Store"
											value={pattern}
										/>
										<Button
											onClick={() =>
												setExcludePatterns(
													excludePatterns.filter((_, j) => j !== i)
												)
											}
											size="icon"
											type="button"
											variant="ghost"
										>
											<Trash2 className="size-4" />
										</Button>
									</div>
								))}
								<Button
									onClick={() => setExcludePatterns([...excludePatterns, ""])}
									size="sm"
									type="button"
									variant="outline"
								>
									<Plus className="size-4" />
									Add Pattern
								</Button>
								<p className="text-muted-foreground text-xs">
									Regex patterns matched against relative file paths.
								</p>
							</div>
						</Field>
						<Button
							disabled={!canSubmit || createMutation.isPending}
							type="submit"
						>
							{createMutation.isPending ? "Creating..." : "Create"}
						</Button>
					</FieldGroup>
				</form>
			</DialogContent>
		</Dialog>
	);
}
