import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { normalizeError } from '@/app/store/api-error.js';
import { useVerifyEmailMutation } from '@/features/auth/api/auth.api.js';
import { ResendVerificationForm } from '@/features/auth/components/resend-verification-form.tsx';
import { useTranslator } from '@/i18n/locale-context.js';

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
					<ResendVerificationForm />
				</section>
			);
		}

		return <p className="muted">{t('auth.verifyEmail.verifying')}</p>;
	}

	return (
		<section className="card">
			<h1>{t('auth.verifyEmail.pendingTitle')}</h1>
			<p>{t('auth.verifyEmail.pendingBody')}</p>
			<ResendVerificationForm />
		</section>
	);
}
