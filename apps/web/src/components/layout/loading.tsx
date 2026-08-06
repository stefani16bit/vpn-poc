import type { ReactNode } from 'react';

import { useTranslator } from '@/i18n/locale-context.tsx';

export function Loading(): ReactNode {
	const t = useTranslator();

	return (
		<p role="status" className="text-muted-foreground">
			{t('common.loading')}
		</p>
	);
}
