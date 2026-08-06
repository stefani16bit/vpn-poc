import type { ReactNode } from 'react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';

export function AuthCard({
	title,
	children,
}: {
	title: string;
	children: ReactNode;
}): ReactNode {
	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle className="text-xl">{title}</CardTitle>
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	);
}
