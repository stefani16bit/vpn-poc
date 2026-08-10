import type { ReactNode } from 'react';

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
import { useTranslator } from '@/i18n/locale-context.tsx';

export function RevokeDeviceDialog({
	name,
	pending,
	onConfirm,
}: {
	name: string;
	pending: boolean;
	onConfirm: () => void;
}): ReactNode {
	const t = useTranslator();

	return (
		<AlertDialog>
			<AlertDialogTrigger
				disabled={pending}
				className={buttonVariants({ variant: 'outline', size: 'sm' })}
			>
				{t('keys.revoke')}
			</AlertDialogTrigger>

			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('keys.revokeConfirmTitle')}</AlertDialogTitle>
					<AlertDialogDescription>
						{t('keys.revokeConfirmBody', { name })}
						<strong className="mt-2 block font-normal">{t('keys.revokeClientWarning')}</strong>
					</AlertDialogDescription>
				</AlertDialogHeader>

				<AlertDialogFooter>
					<AlertDialogCancel>{t('keys.revokeConfirmDismiss')}</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm}>{t('keys.revokeConfirmAccept')}</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
