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

export function RemoveUserDialog({
	email,
	pending,
	onConfirm,
}: {
	email: string;
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
				{t('users.remove')}
			</AlertDialogTrigger>

			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('users.removeConfirmTitle', { email })}</AlertDialogTitle>
					<AlertDialogDescription>{t('users.removeConfirmBody')}</AlertDialogDescription>
				</AlertDialogHeader>

				<AlertDialogFooter>
					<AlertDialogCancel>{t('users.removeConfirmDismiss')}</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm}>
						{t('users.removeConfirmAccept')}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
