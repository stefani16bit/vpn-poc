import type { ReactNode } from 'react';

import type { Cadence, SubscriptionResponse } from '@vpn/contracts';

import { Button } from '@/components/ui/button.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

export function PlanActions({
	subscription,
	pending,
	onSubscribe,
	onCancel,
}: {
	subscription: SubscriptionResponse | undefined;
	pending: boolean;
	onSubscribe: (cadence: Cadence) => void;
	onCancel: () => void;
}): ReactNode {
	const t = useTranslator();
	const status = subscription?.status ?? 'none';

	if (status === 'none' || status === 'canceled') {
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

	return (
		<Button
			type="button"
			variant="outline"
			className="mt-4"
			disabled={pending || subscription?.cancelAtPeriodEnd}
			onClick={onCancel}
		>
			{t('billing.cancel')}
		</Button>
	);
}
