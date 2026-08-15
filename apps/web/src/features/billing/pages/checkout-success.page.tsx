import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { resolveTier } from '@vpn/contracts';

import { normalizeError } from '@/app/store/api-error.js';
import { FormError } from '@/components/form/form-error.tsx';
import { Loading } from '@/components/layout/loading.tsx';
import { MessageScreen } from '@/components/layout/message-screen.tsx';
import { Button } from '@/components/ui/button.tsx';
import { useSubscriptionQuery } from '@/features/billing/api/billing.api.js';
import { PlanEntitlements } from '@/features/billing/components/plan-entitlements.tsx';
import { SubscriptionStatus } from '@/features/billing/components/subscription-status.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

const ACTIVATION_POLL_INTERVAL_MS = 2000;
const ACTIVATION_POLL_TIMEOUT_MS = 15_000;

export function CheckoutSuccessPage(): ReactNode {
	const t = useTranslator();
	const [waiting, setWaiting] = useState(true);

	const subscription = useSubscriptionQuery(undefined, {
		refetchOnMountOrArgChange: true,
		pollingInterval: waiting ? ACTIVATION_POLL_INTERVAL_MS : 0,
	});

	const tier = subscription.data ? resolveTier(subscription.data.status) : null;
	const failedToRead = subscription.isError;

	useEffect(() => {
		if (!waiting) return;
		if (tier !== null || failedToRead) {
			setWaiting(false);
			return;
		}

		const timer = setTimeout(() => setWaiting(false), ACTIVATION_POLL_TIMEOUT_MS);
		return () => clearTimeout(timer);
	}, [waiting, tier, failedToRead]);

	const backToAccount = (
		<p className="mt-4">
			<Link to="/account" className="text-primary underline-offset-4 hover:underline">
				{t('billing.backToAccount')}
			</Link>
		</p>
	);

	if (tier !== null) {
		return (
			<MessageScreen title={t('billing.checkoutSuccess.activeTitle')}>
				<p aria-live="polite">
					{t('billing.checkoutSuccess.activeBody', { tier: t(`billing.tier.${tier}` as never) })}
				</p>
				<div className="mt-4">
					<SubscriptionStatus subscription={subscription.data} />
				</div>
				<PlanEntitlements tier={tier} />
				{backToAccount}
			</MessageScreen>
		);
	}

	if (waiting) {
		return (
			<MessageScreen title={t('billing.checkoutSuccess.receivedTitle')}>
				<p aria-live="polite">{t('billing.checkoutSuccess.activating')}</p>
				<div className="mt-4">
					<Loading />
				</div>
			</MessageScreen>
		);
	}

	return (
		<MessageScreen title={t('billing.checkoutSuccess.receivedTitle')}>
			<p aria-live="polite">{t('billing.checkoutSuccess.stillProcessing')}</p>
			<FormError error={normalizeError(subscription.error)} />
			<Button
				type="button"
				variant="outline"
				className="mt-4"
				onClick={() => {
					setWaiting(true);
					void subscription.refetch();
				}}
			>
				{t('billing.checkoutSuccess.checkAgain')}
			</Button>
			{backToAccount}
		</MessageScreen>
	);
}
