import { useEffect, useRef, type ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';

export function MessageScreen({
	title,
	children,
}: {
	title: string;
	children?: ReactNode;
}): ReactNode {
	const heading = useRef<HTMLDivElement>(null);

	// This screen replaces the form that was focused, so without this the focus
	// sits on a removed subtree and a screen reader is told nothing happened.
	useEffect(() => {
		heading.current?.focus();
	}, []);

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle ref={heading} tabIndex={-1} className="text-xl outline-none">
					{title}
				</CardTitle>
			</CardHeader>
			{children ? <CardContent>{children}</CardContent> : null}
		</Card>
	);
}
