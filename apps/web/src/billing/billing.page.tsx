import { useDispatch, useSelector } from 'react-redux';

import type { PlanId } from '@vpn/contracts';

import { normalizeError } from '../app/store/api-error.js';
import {
	useCancelSubscriptionMutation,
	useCreateCheckoutMutation,
	useLogoutMutation,
	useSubscriptionQuery,
} from '../app/store/api.js';
import { sessionCleared } from '../app/store/auth-slice.js';
import type { AppDispatch, RootState } from '../app/store/index.js';
import { LanguagePicker } from '../i18n/language-picker.js';
import { useLocale } from '../i18n/locale-context.js';
import { FormError } from '../ui/form.tsx';

export function BillingPage() {
	const { t, locale } = useLocale();
	const dispatch = useDispatch<AppDispatch>();
	const user = useSelector((state: RootState) => state.auth.user);

	const subscription = useSubscriptionQuery();
	const [createCheckout, checkoutState] = useCreateCheckoutMutation();
	const [cancelSubscription, cancelState] = useCancelSubscriptionMutation();
	const [logout] = useLogoutMutation();

	async function subscribe(plan: PlanId) {
		const result = await createCheckout({ plan });
		if ('data' in result && result.data) window.location.assign(result.data.checkoutUrl);
	}

	const status = subscription.data?.status ?? 'none';

	return (
		<section className="card">
			<header className="row">
				<h1>{t('billing.accountTitle')}</h1>
				<button
					type="button"
					className="link"
					onClick={async () => {
						await logout();
						dispatch(sessionCleared());
					}}
				>
					{t('auth.logout')}
				</button>
			</header>

			<p className="muted">{user?.email}</p>

			<LanguagePicker />

			<h2>{t('billing.subscriptionTitle')}</h2>

			<FormError error={normalizeError(checkoutState.error ?? cancelState.error)} />

			{subscription.isLoading ? (
				<p className="muted">{t('common.loading')}</p>
			) : (
				<>
					<p>
						<strong>{t(`billing.status.${status}` as never)}</strong>
						{subscription.data?.currentPeriodEnd ? (
							<span className="muted">
								{' '}
								·{' '}
								{t('billing.renewsOn', {
									date: new Date(subscription.data.currentPeriodEnd).toLocaleDateString(locale),
								})}
							</span>
						) : null}
					</p>

					{subscription.data?.cancelAtPeriodEnd ? (
						<p className="muted small">{t('billing.cancelScheduled')}</p>
					) : null}

					{status === 'none' || status === 'canceled' ? (
						<div className="row">
							<button
								type="button"
								className="primary"
								disabled={checkoutState.isLoading}
								onClick={() => void subscribe('monthly')}
							>
								{t('billing.subscribeMonthly')}
							</button>
							<button
								type="button"
								disabled={checkoutState.isLoading}
								onClick={() => void subscribe('yearly')}
							>
								{t('billing.subscribeYearly')}
							</button>
						</div>
					) : (
						<button
							type="button"
							disabled={cancelState.isLoading || subscription.data?.cancelAtPeriodEnd}
							onClick={() => void cancelSubscription()}
						>
							{t('billing.cancel')}
						</button>
					)}
				</>
			)}
		</section>
	);
}
