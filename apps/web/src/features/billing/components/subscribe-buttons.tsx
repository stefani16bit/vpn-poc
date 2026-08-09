import type { ReactNode } from 'react';

import type { Cadence } from '@vpn/contracts';

import { Button } from '@/components/ui/button.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

export function SubscribeButtons({
	pending,
	onSubscribe,
}: {
	pending: boolean;
	onSubscribe: (cadence: Cadence) => void;
}): ReactNode {
	const t = useTranslator();

	return (
		<div className="mt-4 flex flex-wrap gap-3">
			<Button type="button" disabled={pending} onClick={() => onSubscribe('monthly')}>
				{t('billing.subscribeMonthly')}
			</Button>
			<Button
				type="button"
				variant="outline"
				disabled={pending}
				onClick={() => onSubscribe('yearly')}
			>
				{t('billing.subscribeYearly')}
			</Button>
		</div>
	);
}
