import { Separator } from "@indecks/ui/components/separator";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarTrigger,
} from "@indecks/ui/components/sidebar";
import {
	createFileRoute,
	Link,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { Library } from "lucide-react";

import { BreadcrumbSlot } from "@/components/breadcrumb-slot";
import { ModeToggle } from "@/components/mode-toggle";
import { SidebarUser } from "@/components/sidebar-user";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/_authenticated")({
	beforeLoad: async () => {
		const session = await authClient.getSession();
		if (!session.data) {
			redirect({ to: "/login", throw: true });
		}
	},
	component: AuthenticatedLayout,
});

function AppSidebar() {
	return (
		<Sidebar>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<SidebarMenu>
							<SidebarMenuItem>
								<SidebarMenuButton
									render={<Link to="/libraries" />}
									tooltip="Libraries"
								>
									<Library />
									<span>Libraries</span>
								</SidebarMenuButton>
							</SidebarMenuItem>
						</SidebarMenu>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter>
				<SidebarUser />
			</SidebarFooter>
		</Sidebar>
	);
}

function AuthenticatedLayout() {
	return (
		<SidebarProvider
			defaultOpen={
				document.cookie
					.split("; ")
					.find((c) => c.startsWith("sidebar_state="))
					?.split("=")[1] !== "false"
			}
		>
			<AppSidebar />
			<SidebarInset>
				<header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
					<SidebarTrigger className="-ml-1" />
					<Separator className="mr-2 h-4" orientation="vertical" />
					<BreadcrumbSlot />
					<div className="ml-auto flex items-center gap-2">
						<ModeToggle />
					</div>
				</header>
				<div className="flex-1 p-4">
					<Outlet />
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
