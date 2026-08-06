import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';

import { registerRequestSchema, type RegisterRequest } from '@vpn/contracts';

import { normalizeError } from '../app/store/api-error.js';
import { useRegisterMutation } from '../app/store/api.js';
import { useLocale } from '../i18n/locale-context.js';
import { Field, FormError, Submit } from '../ui/form.tsx';

export function SignupPage() {
	const { t, locale } = useLocale();
	const [register, { isLoading, error }] = useRegisterMutation();
	const [submittedTo, setSubmittedTo] = useState<string | null>(null);

	const form = useForm<RegisterRequest>({ resolver: zodResolver(registerRequestSchema) });

	async function onSubmit(values: RegisterRequest) {
		const result = await register({ ...values, locale });
		if ('data' in result) setSubmittedTo(values.email);
	}

	if (submittedTo) {
		return (
			<section className="card">
				<h1>{t('auth.signup.checkInboxTitle')}</h1>
				<p>{t('auth.signup.checkInboxBody', { email: submittedTo })}</p>
				<p className="muted">
					{t('auth.signup.checkInboxExpiry')} <Link to="/login">{t('auth.signup.loginLink')}</Link>
				</p>
			</section>
		);
	}

	return (
		<section className="card">
			<h1>{t('auth.signup.title')}</h1>

			<form onSubmit={form.handleSubmit(onSubmit)} noValidate>
				<FormError error={normalizeError(error)} />

				<Field label={t('auth.signup.email')} error={form.formState.errors.email?.message}>
					<input type="email" autoComplete="email" {...form.register('email')} />
				</Field>

				<Field label={t('auth.signup.password')} error={form.formState.errors.password?.message}>
					<input type="password" autoComplete="new-password" {...form.register('password')} />
				</Field>

				<p className="muted small">{t('auth.signup.passwordHint')}</p>

				<Submit pending={isLoading}>{t('auth.signup.submit')}</Submit>
			</form>

			<p className="muted">
				{t('auth.signup.haveAccount')} <Link to="/login">{t('auth.signup.loginLink')}</Link>
			</p>
		</section>
	);
}
