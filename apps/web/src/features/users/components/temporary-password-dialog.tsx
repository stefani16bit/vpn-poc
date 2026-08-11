import { useState, type ReactNode } from 'react';

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog.tsx';
import { Button } from '@/components/ui/button.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

export function TemporaryPasswordDialog({
	email,
	password,
	onDismiss,
}: {
	email: string;
	password: string;
	onDismiss: () => void;
}): ReactNode {
	const t = useTranslator();
	const [copied, setCopied] = useState(false);

	async function copy(): Promise<void> {
		await navigator.clipboard.writeText(password);
		setCopied(true);
	}

	return (
		<AlertDialog open>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t('users.passwordTitle', { email })}</AlertDialogTitle>
					<AlertDialogDescription>{t('users.passwordBody')}</AlertDialogDescription>
				</AlertDialogHeader>

				<code className="block rounded-md bg-muted p-3 font-mono text-sm break-all">
					{password}
				</code>

				<Button type="button" variant="outline" onClick={() => void copy()}>
					{t('users.passwordCopy')}
				</Button>

				{copied ? (
					<p className="text-sm text-muted-foreground">{t('users.passwordCopied')}</p>
				) : null}

				<AlertDialogFooter>
					<AlertDialogAction onClick={onDismiss}>{t('users.passwordDone')}</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
