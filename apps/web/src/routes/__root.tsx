import { Separator } from "@indecks/ui/components/separator";
import {
	Sidebar,
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarInset,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarProvider,
	SidebarTrigger,
} from "@indecks/ui/components/sidebar";
import { Toaster } from "@indecks/ui/components/sonner";
import { TooltipProvider } from "@indecks/ui/components/tooltip";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Link,
	Outlet,
} from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { Library } from "lucide-react";
import { NuqsAdapter } from "nuqs/adapters/tanstack-router";

import { BreadcrumbSlotProvider } from "@/components/breadcrumb-slot";
import { ModeToggle } from "@/components/mode-toggle";
import { ThemeProvider } from "@/components/theme-provider";
import UserMenu from "@/components/user-menu";
import type { trpc } from "@/utils/trpc";

import "../index.css";

export interface RouterAppContext {
	queryClient: QueryClient;
	trpc: typeof trpc;
}

export const Route = createRootRouteWithContext<RouterAppContext>()({
	component: RootComponent,
	head: () => ({
		meta: [
			{
				title: "indecks",
			},
			{
				name: "description",
				content: "indecks is a web application",
			},
		],
		links: [
			{
				rel: "icon",
				href: "/favicon.ico",
			},
		],
	}),
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
		</Sidebar>
	);
}

function RootComponent() {
	return (
		<>
			<HeadContent />
			<ThemeProvider
				attribute="class"
				defaultTheme="dark"
				disableTransitionOnChange
				storageKey="vite-ui-theme"
			>
				<NuqsAdapter>
					<TooltipProvider>
						<BreadcrumbSlotProvider>
							{(breadcrumb) => (
								<SidebarProvider>
									<AppSidebar />
									<SidebarInset>
										<header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
											<SidebarTrigger className="-ml-1" />
											<Separator className="mr-2 h-4" orientation="vertical" />
											{breadcrumb}
											<div className="ml-auto flex items-center gap-2">
												<ModeToggle />
												<UserMenu />
											</div>
										</header>
										<div className="flex-1 p-4">
											<Outlet />
										</div>
									</SidebarInset>
								</SidebarProvider>
							)}
						</BreadcrumbSlotProvider>
					</TooltipProvider>
					<Toaster richColors />
				</NuqsAdapter>
			</ThemeProvider>
			<TanStackRouterDevtools position="bottom-left" />
			<ReactQueryDevtools buttonPosition="bottom-right" position="bottom" />
		</>
	);
}
