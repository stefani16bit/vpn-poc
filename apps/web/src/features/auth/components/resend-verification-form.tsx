import { useEffect, useId, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { useResendVerificationMutation } from '@/features/auth/api/auth.api.js';
import { useTranslator } from '@/i18n/locale-context.tsx';

const RESEND_COOLDOWN_SECONDS = 60;

export function ResendVerificationForm() {
	const t = useTranslator();
	const [resend, { isLoading }] = useResendVerificationMutation();
	const [email, setEmail] = useState('');
	const [cooldown, setCooldown] = useState(0);
	const id = useId();

	useEffect(() => {
		if (cooldown <= 0) return;
		const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
		return () => clearTimeout(timer);
	}, [cooldown]);

	return (
		<form
			className="mt-4 grid gap-2"
			onSubmit={(event) => {
				event.preventDefault();
				if (cooldown > 0) return;
				void resend({ email });
				setCooldown(RESEND_COOLDOWN_SECONDS);
			}}
		>
			<Label htmlFor={id}>{t('auth.verifyEmail.email')}</Label>
			<Input
				id={id}
				type="email"
				value={email}
				onChange={(event) => setEmail(event.target.value)}
				required
			/>

			<Button type="submit" disabled={isLoading || cooldown > 0} aria-busy={isLoading}>
				{cooldown > 0
					? t('auth.verifyEmail.resendIn', { seconds: cooldown })
					: t('auth.verifyEmail.resend')}
			</Button>

			<span aria-live="polite" className="sr-only">
				{cooldown > 0 ? t('auth.verifyEmail.resendIn', { seconds: cooldown }) : ''}
			</span>
		</form>
	);
}
