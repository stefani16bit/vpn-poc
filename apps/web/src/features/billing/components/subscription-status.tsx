import type { ReactNode } from 'react';

import type { SubscriptionResponse } from '@vpn/contracts';

import { useLocale } from '@/i18n/locale-context.tsx';

export function SubscriptionStatus({
	subscription,
}: {
	subscription: SubscriptionResponse | undefined;
}): ReactNode {
	const { t, locale } = useLocale();
	const status = subscription?.status ?? 'none';

	return (
		<>
			<p>
				<strong>{t(`billing.status.${status}` as never)}</strong>
				{subscription?.currentPeriodEnd ? (
					<span className="text-muted-foreground">
						{' '}
						·{' '}
						{t('billing.renewsOn', {
							date: new Date(subscription.currentPeriodEnd).toLocaleDateString(locale),
						})}
					</span>
				) : null}
			</p>

			{subscription?.cancelAtPeriodEnd ? (
				<p className="mt-2 text-sm text-muted-foreground">{t('billing.cancelScheduled')}</p>
			) : null}
		</>
	);
}
