import type { ReactNode } from 'react';

import type { SubscriptionResponse } from '@vpn/contracts';

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { useLocale } from '@/i18n/locale-context.tsx';

export function CancelSubscriptionDialog({
	subscription,
	pending,
	onConfirm,
}: {
	subscription: SubscriptionResponse | undefined;
	pending: boolean;
	onConfirm: () => void;
}): ReactNode {
	const { t, locale } = useLocale();

	const date = subscription?.currentPeriodEnd
		? new Date(subscription.currentPeriodEnd).toLocaleDateString(locale)
		: t('billing.periodEndUnknown');

	return (
		<AlertDialog>
			<AlertDialogTrigger
				disabled={pending}
				className={buttonVariants({ variant: 'outline', className: 'mt-4' })}
			>
				{t('billing.cancel')}
			</AlertDialogTrigger>

			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('billing.cancelConfirmTitle')}</AlertDialogTitle>
					<AlertDialogDescription>
						{t('billing.cancelConfirmBody', { date })}
					</AlertDialogDescription>
				</AlertDialogHeader>

				<AlertDialogFooter>
					<AlertDialogCancel>{t('billing.cancelConfirmDismiss')}</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm}>
						{t('billing.cancelConfirmAccept')}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
