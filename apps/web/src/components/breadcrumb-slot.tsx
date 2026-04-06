import type { ReactNode } from "react";
import { createContext, useContext, useLayoutEffect, useState } from "react";

interface BreadcrumbSlotContextValue {
	setBreadcrumb: (node: ReactNode) => void;
}

const BreadcrumbSlotContext = createContext<BreadcrumbSlotContextValue>({
	setBreadcrumb: () => undefined,
});

export function BreadcrumbSlotProvider({
	children,
}: {
	children: (breadcrumb: ReactNode) => ReactNode;
}) {
	const [breadcrumb, setBreadcrumb] = useState<ReactNode>(null);

	return (
		<BreadcrumbSlotContext value={{ setBreadcrumb }}>
			{children(breadcrumb)}
		</BreadcrumbSlotContext>
	);
}

export function BreadcrumbPortal({ children }: { children: ReactNode }) {
	const { setBreadcrumb } = useContext(BreadcrumbSlotContext);

	useLayoutEffect(() => {
		setBreadcrumb(children);
		return () => setBreadcrumb(null);
	}, [children, setBreadcrumb]);

	return null;
}
