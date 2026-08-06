import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import {
	forgotPasswordRequestSchema,
	resetPasswordRequestSchema,
	type ForgotPasswordRequest,
	type ResetPasswordRequest,
} from '@vpn/contracts';

import { normalizeError } from '../app/store/api-error.js';
import { useForgotPasswordMutation, useResetPasswordMutation } from '@/features/auth/api/auth.api.js';
import { useTranslator } from '../i18n/locale-context.js';
import { Field, FormError, Submit } from '../ui/form.tsx';

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

export function ResetPasswordPage() {
	const t = useTranslator();
	const [params] = useSearchParams();
	const navigate = useNavigate();
	const [resetPassword, { isLoading, error }] = useResetPasswordMutation();

	const token = params.get('token') ?? '';

	const form = useForm<ResetPasswordRequest>({
		resolver: zodResolver(resetPasswordRequestSchema),
		defaultValues: { token },
	});

	if (!token) {
		return (
			<section className="card">
				<h1>{t('auth.resetPassword.invalidLinkTitle')}</h1>
				<p>{t('auth.resetPassword.invalidLinkBody')}</p>
				<p>
					<Link to="/forgot-password">{t('auth.resetPassword.requestNew')}</Link>
				</p>
			</section>
		);
	}

	return (
		<section className="card">
			<h1>{t('auth.resetPassword.title')}</h1>

			<form
				onSubmit={form.handleSubmit(async (values) => {
					const result = await resetPassword(values);
					if ('data' in result) navigate('/login', { replace: true });
				})}
				noValidate
			>
				<FormError error={normalizeError(error)} />

				<input type="hidden" {...form.register('token')} />

				<Field
					label={t('auth.resetPassword.password')}
					error={form.formState.errors.password?.message}
				>
					<input type="password" autoComplete="new-password" {...form.register('password')} />
				</Field>

				<p className="muted small">{t('auth.resetPassword.warning')}</p>

				<Submit pending={isLoading}>{t('auth.resetPassword.submit')}</Submit>
			</form>
		</section>
	);
}
