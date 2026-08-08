import type { ReactNode } from 'react';

import { ENTITLEMENTS, type TierId } from '@vpn/contracts';

import { useTranslator } from '@/i18n/locale-context.tsx';

export function PlanEntitlements({ tier }: { tier: TierId }): ReactNode {
	const t = useTranslator();
	const entitlements = ENTITLEMENTS[tier];

	return (
		<section className="mt-6">
			<h3 className="text-sm font-medium text-muted-foreground">{t('billing.planTitle')}</h3>
			<ul className="mt-2 space-y-1 text-sm text-muted-foreground">
				<li>{t('billing.seats', { count: entitlements.seats })}</li>
				<li>{t('billing.devicesPerUser', { count: entitlements.devicesPerUser })}</li>
				<li>{t('billing.monthlyTrafficGb', { count: entitlements.monthlyTrafficGb })}</li>
				<li>{t('billing.regions', { regions: entitlements.regions.join(', ').toUpperCase() })}</li>
			</ul>
		</section>
	);
}
