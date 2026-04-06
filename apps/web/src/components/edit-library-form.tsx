import { Button } from "@indecks/ui/components/button";
import { Calendar } from "@indecks/ui/components/calendar";
import { Field, FieldGroup, FieldLabel } from "@indecks/ui/components/field";
import { Input } from "@indecks/ui/components/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@indecks/ui/components/popover";
import { cn } from "@indecks/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { queryClient, trpcClient } from "@/utils/trpc";

function parseDate(iso: string | null): Date | undefined {
	if (!iso) {
		return undefined;
	}
	return new Date(iso);
}

function DatePicker({
	value,
	onChange,
	label,
}: {
	value: Date | undefined;
	onChange: (date: Date | undefined) => void;
	label: string;
}) {
	const [open, setOpen] = useState(false);

	return (
		<Popover onOpenChange={setOpen} open={open}>
			<PopoverTrigger
				render={
					<Button
						className={cn(
							"w-full justify-start text-left font-normal",
							!value && "text-muted-foreground"
						)}
						type="button"
						variant="outline"
					/>
				}
			>
				<CalendarIcon className="mr-2 size-4" />
				{value ? format(value, "PPP") : <span>{label}</span>}
				{value && (
					<button
						className="ml-auto rounded-sm p-0.5 hover:bg-muted"
						onClick={(e) => {
							e.stopPropagation();
							onChange(undefined);
						}}
						type="button"
					>
						<X className="size-3" />
					</button>
				)}
			</PopoverTrigger>
			<PopoverContent align="start" className="w-auto p-0">
				<Calendar
					captionLayout="dropdown"
					mode="single"
					onSelect={(date) => {
						onChange(date);
						setOpen(false);
					}}
					selected={value}
				/>
			</PopoverContent>
		</Popover>
	);
}

export function EditLibraryForm({
	library,
}: {
	library: {
		id: string;
		name: string;
		folderPaths: string;
		scanConcurrency: number;
		excludePatterns: string;
		scanModifiedAfter: string | null;
		scanModifiedBefore: string | null;
	};
}) {
	const [name, setName] = useState(library.name);
	const [folderPaths, setFolderPaths] = useState<string[]>(() =>
		JSON.parse(library.folderPaths)
	);
	const [scanConcurrency, setScanConcurrency] = useState(
		library.scanConcurrency
	);
	const [excludePatterns, setExcludePatterns] = useState<string[]>(() =>
		JSON.parse(library.excludePatterns ?? "[]")
	);
	const [scanModifiedAfter, setScanModifiedAfter] = useState<Date | undefined>(
		() => parseDate(library.scanModifiedAfter)
	);
	const [scanModifiedBefore, setScanModifiedBefore] = useState<
		Date | undefined
	>(() => parseDate(library.scanModifiedBefore));

	const updateMutation = useMutation({
		mutationFn: () =>
			trpcClient.library.update.mutate({
				id: library.id,
				name,
				folderPaths: folderPaths.filter((p) => p.trim()),
				scanConcurrency,
				excludePatterns: excludePatterns.filter((p) => p.trim()),
				scanModifiedAfter: scanModifiedAfter?.toISOString() ?? null,
				scanModifiedBefore: scanModifiedBefore?.toISOString() ?? null,
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
				<Field>
					<FieldLabel>Modified After</FieldLabel>
					<DatePicker
						label="No lower bound"
						onChange={setScanModifiedAfter}
						value={scanModifiedAfter}
					/>
					<p className="text-muted-foreground text-xs">
						Only include files modified after this date.
					</p>
				</Field>
				<Field>
					<FieldLabel>Modified Before</FieldLabel>
					<DatePicker
						label="No upper bound"
						onChange={setScanModifiedBefore}
						value={scanModifiedBefore}
					/>
					<p className="text-muted-foreground text-xs">
						Only include files modified before this date.
					</p>
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
