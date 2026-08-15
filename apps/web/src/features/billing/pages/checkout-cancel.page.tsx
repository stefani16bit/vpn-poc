import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { normalizeError } from '@/app/store/api-error.js';
import { FormError } from '@/components/form/form-error.tsx';
import { MessageScreen } from '@/components/layout/message-screen.tsx';
import { SubscribeButtons } from '@/features/billing/components/subscribe-buttons.tsx';
import { useStartCheckout } from '@/features/billing/hooks/use-start-checkout.js';
import { useTranslator } from '@/i18n/locale-context.tsx';

export function CheckoutCancelPage(): ReactNode {
	const t = useTranslator();
	const checkout = useStartCheckout();

	return (
		<MessageScreen title={t('billing.checkoutCancel.title')}>
			<p>{t('billing.checkoutCancel.body')}</p>

			<FormError error={normalizeError(checkout.error)} />

			<SubscribeButtons
				pending={checkout.pending}
				onSubscribe={(cadence) => void checkout.start(cadence)}
			/>

			<p className="mt-4">
				<Link to="/account" className="text-primary underline-offset-4 hover:underline">
					{t('billing.backToAccount')}
				</Link>
			</p>
		</MessageScreen>
	);
}
