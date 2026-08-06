import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { normalizeError } from '../app/store/api-error.js';
import { useResendVerificationMutation, useVerifyEmailMutation } from '../app/store/api.js';
import { useTranslator } from '../i18n/locale-context.js';

const RESEND_COOLDOWN_SECONDS = 60;

export function VerifyEmailPage() {
	const t = useTranslator();
	const [params] = useSearchParams();
	const token = params.get('token');

	const [verifyEmail, verifyState] = useVerifyEmailMutation();
	const redeemed = useRef(false);

	useEffect(() => {
		if (!token || redeemed.current) return;
		redeemed.current = true;
		void verifyEmail({ token });
	}, [token, verifyEmail]);

	if (token) {
		if (verifyState.isSuccess) {
			return (
				<section className="card">
					<h1>{t('auth.verifyEmail.successTitle')}</h1>
					<p>{t('auth.verifyEmail.successBody')}</p>
					<p>
						<Link to="/login">{t('auth.login.submit')}</Link>
					</p>
				</section>
			);
		}

		const error = normalizeError(verifyState.error);
		if (error) {
			return (
				<section className="card">
					<h1>{t('auth.verifyEmail.failureTitle')}</h1>
					<p role="alert">{t(`errors.${error.code}` as never)}</p>
					<ResendForm />
				</section>
			);
		}

		return <p className="muted">{t('auth.verifyEmail.verifying')}</p>;
	}

	return (
		<section className="card">
			<h1>{t('auth.verifyEmail.pendingTitle')}</h1>
			<p>{t('auth.verifyEmail.pendingBody')}</p>
			<ResendForm />
		</section>
	);
}

function ResendForm() {
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
