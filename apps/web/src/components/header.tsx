import { Separator } from "@indecks/ui/components/separator";
import { Link } from "@tanstack/react-router";

import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";

export default function Header() {
	const links = [
		{ to: "/", label: "indecks" },
		{ to: "/libraries", label: "Libraries" },
	] as const;

	return (
		<div>
			<div className="flex flex-row items-center justify-between px-3 py-1.5">
				<nav className="flex items-center gap-4 text-sm">
					{links.map(({ to, label }) => (
						<Link key={to} to={to}>
							{label}
						</Link>
					))}
				</nav>
				<div className="flex items-center gap-2">
					<ModeToggle />
					<UserMenu />
				</div>
			</div>
			<Separator />
		</div>
	);
}
