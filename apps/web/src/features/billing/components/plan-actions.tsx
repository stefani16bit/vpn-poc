import type { ReactNode } from 'react';

import type { Cadence, SubscriptionResponse } from '@vpn/contracts';

import { useHasPermission } from '@/app/access/use-has-permission.js';

import { Button } from '@/components/ui/button.tsx';
import { CancelSubscriptionDialog } from '@/features/billing/components/cancel-subscription-dialog.tsx';
import { SubscribeButtons } from '@/features/billing/components/subscribe-buttons.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

export function PlanActions({
	subscription,
	pending,
	onSubscribe,
	onCancel,
	onResume,
}: {
	subscription: SubscriptionResponse | undefined;
	pending: boolean;
	onSubscribe: (cadence: Cadence) => void;
	onCancel: () => void;
	onResume: () => void;
}): ReactNode {
	const t = useTranslator();
	const canManage = useHasPermission('billing.manage');
	const status = subscription?.status ?? 'none';

	if (!canManage) return null;

	if (status === 'none' || status === 'canceled') {
		return <SubscribeButtons pending={pending} onSubscribe={onSubscribe} />;
	}

	if (subscription?.cancelAtPeriodEnd) {
		return (
			<Button type="button" className="mt-4" disabled={pending} onClick={onResume}>
				{t('billing.resume')}
			</Button>
		);
	}

	return (
		<CancelSubscriptionDialog subscription={subscription} pending={pending} onConfirm={onCancel} />
	);
}
