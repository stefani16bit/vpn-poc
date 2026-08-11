import { useDispatch, useSelector } from 'react-redux';

import { normalizeError } from '@/app/store/api-error.js';
import { sessionCleared } from '@/app/store/auth-slice.js';
import type { AppDispatch, RootState } from '@/app/store/index.js';
import { useLogoutMutation } from '@/app/store/session.api.js';
import { FormError } from '@/components/form/form-error.tsx';
import { Loading } from '@/components/layout/loading.tsx';
import { Nav } from '@/components/layout/nav.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import {
	useCancelSubscriptionMutation,
	useResumeSubscriptionMutation,
	useSubscriptionQuery,
} from '@/features/billing/api/billing.api.js';
import { PlanActions } from '@/features/billing/components/plan-actions.tsx';
import { PlanEntitlements } from '@/features/billing/components/plan-entitlements.tsx';
import { SubscriptionStatus } from '@/features/billing/components/subscription-status.tsx';
import { useStartCheckout } from '@/features/billing/hooks/use-start-checkout.js';
import { LanguagePicker } from '@/i18n/language-picker.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

export function BillingPage() {
	const t = useTranslator();
	const dispatch = useDispatch<AppDispatch>();
	const user = useSelector((state: RootState) => state.auth.user);

	const subscription = useSubscriptionQuery();
	const checkout = useStartCheckout();
	const [cancelSubscription, cancelState] = useCancelSubscriptionMutation();
	const [resumeSubscription, resumeState] = useResumeSubscriptionMutation();
	const [logout] = useLogoutMutation();

	return (
		<Card className="w-full max-w-md">
			<CardHeader className="flex flex-row items-center justify-between gap-4">
				<CardTitle className="text-xl">{t('billing.accountTitle')}</CardTitle>
				<Button
					type="button"
					variant="link"
					className="h-auto p-0"
					onClick={async () => {
						await logout();
						dispatch(sessionCleared());
					}}
				>
					{t('auth.logout')}
				</Button>
			</CardHeader>

			<CardContent>
				<p className="text-muted-foreground">{user?.email}</p>

				<LanguagePicker />

				<h2 className="mt-8 mb-3 text-lg font-medium">{t('billing.subscriptionTitle')}</h2>

				<FormError
					error={normalizeError(checkout.error ?? cancelState.error ?? resumeState.error)}
				/>

				{subscription.isLoading ? (
					<Loading />
				) : (
					<>
						<SubscriptionStatus subscription={subscription.data} />
						<PlanActions
							subscription={subscription.data}
							role={user?.role}
							pending={checkout.pending || cancelState.isLoading || resumeState.isLoading}
							onSubscribe={(cadence) => void checkout.start(cadence)}
							onCancel={() => void cancelSubscription()}
							onResume={() => void resumeSubscription()}
						/>
						<PlanEntitlements tier="pro" />
						<Nav />
					</>
				)}
			</CardContent>
		</Card>
	);
}
