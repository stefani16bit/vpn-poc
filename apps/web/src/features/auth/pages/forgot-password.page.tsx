import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';

import { forgotPasswordRequestSchema, type ForgotPasswordRequest } from '@vpn/contracts';

import { normalizeError } from '@/app/store/api-error.js';
import { useForgotPasswordMutation } from '@/features/auth/api/auth.api.js';
import { useTranslator } from '@/i18n/locale-context.js';
import { Field, FormError, Submit } from '@/ui/form.tsx';

export function ForgotPasswordPage() {
	const t = useTranslator();
	const [forgotPassword, { isLoading, error }] = useForgotPasswordMutation();
	const [sent, setSent] = useState(false);

	const form = useForm<ForgotPasswordRequest>({
		resolver: zodResolver(forgotPasswordRequestSchema),
	});

	if (sent) {
		return (
			<section className="card">
				<h1>{t('auth.forgotPassword.sentTitle')}</h1>
				<p>{t('auth.forgotPassword.sentBody')}</p>
				<p className="muted">
					{t('auth.forgotPassword.sentExpiry')} <Link to="/login">{t('common.back')}</Link>
				</p>
			</section>
		);
	}

	return (
		<section className="card">
			<h1>{t('auth.forgotPassword.title')}</h1>

			<form
				onSubmit={form.handleSubmit(async (values) => {
					const result = await forgotPassword(values);
					if ('data' in result) setSent(true);
				})}
				noValidate
			>
				<FormError error={normalizeError(error)} />

				<Field label={t('auth.forgotPassword.email')} error={form.formState.errors.email?.message}>
					<input type="email" autoComplete="email" {...form.register('email')} />
				</Field>

				<Submit pending={isLoading}>{t('auth.forgotPassword.submit')}</Submit>
			</form>
		</section>
	);
}
