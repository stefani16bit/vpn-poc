import { useEffect, useState } from 'react';

import { useResendVerificationMutation } from '@/features/auth/api/auth.api.js';
import { useTranslator } from '@/i18n/locale-context.js';

const RESEND_COOLDOWN_SECONDS = 60;

export function ResendVerificationForm() {
	const t = useTranslator();
	const [resend, { isLoading }] = useResendVerificationMutation();
	const [email, setEmail] = useState('');
	const [cooldown, setCooldown] = useState(0);

	useEffect(() => {
		if (cooldown <= 0) return;
		const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
		return () => clearTimeout(timer);
	}, [cooldown]);

	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				if (cooldown > 0) return;
				void resend({ email });
				setCooldown(RESEND_COOLDOWN_SECONDS);
			}}
		>
			<label className="field">
				<span className="field-label">{t('auth.verifyEmail.email')}</span>
				<input
					type="email"
					value={email}
					onChange={(event) => setEmail(event.target.value)}
					required
				/>
			</label>

			<button type="submit" className="primary" disabled={isLoading || cooldown > 0}>
				{cooldown > 0
					? t('auth.verifyEmail.resendIn', { seconds: cooldown })
					: t('auth.verifyEmail.resend')}
			</button>
		</form>
	);
}
