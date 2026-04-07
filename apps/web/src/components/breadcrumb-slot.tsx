import type { ReactNode } from "react";
import { createContext, useContext, useLayoutEffect, useState } from "react";

interface BreadcrumbSlotContextValue {
	breadcrumb: ReactNode;
	setBreadcrumb: (node: ReactNode) => void;
}

const BreadcrumbSlotContext = createContext<BreadcrumbSlotContextValue>({
	setBreadcrumb: () => undefined,
	breadcrumb: null,
});

export function BreadcrumbSlotProvider({ children }: { children: ReactNode }) {
	const [breadcrumb, setBreadcrumb] = useState<ReactNode>(null);

	return (
		<BreadcrumbSlotContext value={{ setBreadcrumb, breadcrumb }}>
			{children}
		</BreadcrumbSlotContext>
	);
}

export function BreadcrumbSlot() {
	const { breadcrumb } = useContext(BreadcrumbSlotContext);
	return <>{breadcrumb}</>;
}

export function BreadcrumbPortal({ children }: { children: ReactNode }) {
	const { setBreadcrumb } = useContext(BreadcrumbSlotContext);

	useLayoutEffect(() => {
		setBreadcrumb(children);
		return () => setBreadcrumb(null);
	}, [children, setBreadcrumb]);

	return null;
}
