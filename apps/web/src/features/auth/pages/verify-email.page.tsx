import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { normalizeError } from '@/app/store/api-error.js';
import { Loading } from '@/components/layout/loading.tsx';
import { MessageScreen } from '@/components/layout/message-screen.tsx';
import { useVerifyEmailMutation } from '@/features/auth/api/auth.api.js';
import { ResendVerificationForm } from '@/features/auth/components/resend-verification-form.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

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
				<MessageScreen title={t('auth.verifyEmail.successTitle')}>
					<p>{t('auth.verifyEmail.successBody')}</p>
					<p className="mt-4">
						<Link to="/login" className="text-primary underline-offset-4 hover:underline">
							{t('auth.login.submit')}
						</Link>
					</p>
				</MessageScreen>
			);
		}

		const error = normalizeError(verifyState.error);
		if (error) {
			return (
				<MessageScreen title={t('auth.verifyEmail.failureTitle')}>
					<p role="alert" className="text-destructive">
						{t(`errors.${error.code}` as never)}
					</p>
					<ResendVerificationForm />
				</MessageScreen>
			);
		}

		return <Loading />;
	}

	return (
		<MessageScreen title={t('auth.verifyEmail.pendingTitle')}>
			<p>{t('auth.verifyEmail.pendingBody')}</p>
			<ResendVerificationForm />
		</MessageScreen>
	);
}
