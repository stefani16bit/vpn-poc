import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

export function SubmitButton({
	pending,
	children,
}: {
	pending: boolean;
	children: ReactNode;
}): ReactNode {
	const t = useTranslator();

	return (
		<Button type="submit" disabled={pending} aria-busy={pending}>
			{pending ? t('common.wait') : children}
		</Button>
	);
}
