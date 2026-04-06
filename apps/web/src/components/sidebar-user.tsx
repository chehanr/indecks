import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@indecks/ui/components/dropdown-menu";
import {
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@indecks/ui/components/sidebar";
import { Skeleton } from "@indecks/ui/components/skeleton";
import { useNavigate } from "@tanstack/react-router";
import { ChevronsUpDown, LogOut, User } from "lucide-react";

import { authClient } from "@/lib/auth-client";

export function SidebarUser() {
	const navigate = useNavigate();
	const { isMobile } = useSidebar();
	const { data: session, isPending } = authClient.useSession();

	if (isPending) {
		return (
			<SidebarMenu>
				<SidebarMenuItem>
					<Skeleton className="h-8 w-full" />
				</SidebarMenuItem>
			</SidebarMenu>
		);
	}

	if (!session) {
		return null;
	}

	return (
		<SidebarMenu>
			<SidebarMenuItem>
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<SidebarMenuButton
								className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
								size="lg"
							>
								<div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
									<User className="size-4" />
								</div>
								<div className="grid flex-1 text-left text-sm leading-tight">
									<span className="truncate font-medium">
										{session.user.name}
									</span>
									<span className="truncate text-xs">{session.user.email}</span>
								</div>
								<ChevronsUpDown className="ml-auto size-4" />
							</SidebarMenuButton>
						}
					/>
					<DropdownMenuContent
						align="end"
						className="w-56"
						side={isMobile ? "bottom" : "right"}
						sideOffset={4}
					>
						<DropdownMenuGroup>
							<DropdownMenuLabel className="font-normal">
								<div className="flex flex-col gap-1">
									<p className="font-medium text-sm">{session.user.name}</p>
									<p className="text-muted-foreground text-xs">
										{session.user.email}
									</p>
								</div>
							</DropdownMenuLabel>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem
								onClick={() => {
									authClient.signOut({
										fetchOptions: {
											onSuccess: () => {
												navigate({ to: "/" });
											},
										},
									});
								}}
								variant="destructive"
							>
								<LogOut />
								Sign Out
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</SidebarMenuItem>
		</SidebarMenu>
	);
}
