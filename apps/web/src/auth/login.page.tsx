import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useDispatch } from 'react-redux';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { loginRequestSchema, type LoginRequest } from '@vpn/contracts';

import { normalizeError } from '../app/store/api-error.js';
import { useLoginMutation } from '@/features/auth/api/auth.api.js';
import { sessionResolved } from '../app/store/auth-slice.js';
import type { AppDispatch } from '../app/store/index.js';
import { useTranslator } from '../i18n/locale-context.js';
import { Field, FormError, Submit } from '../ui/form.tsx';

export function LoginPage() {
	const t = useTranslator();
	const dispatch = useDispatch<AppDispatch>();
	const navigate = useNavigate();
	const location = useLocation();
	const [login, { isLoading, error }] = useLoginMutation();

	const form = useForm<LoginRequest>({ resolver: zodResolver(loginRequestSchema) });
	const normalized = normalizeError(error);

	const from = (location.state as { from?: string } | null)?.from ?? '/';

	async function onSubmit(values: LoginRequest) {
		const result = await login(values);
		if ('data' in result && result.data) {
			dispatch(sessionResolved({ user: result.data.user, accessToken: result.data.accessToken }));
			navigate(from, { replace: true });
		}
	}

	if (normalized?.code === 'EMAIL_NOT_VERIFIED') {
		return <Navigate to="/verify-email" replace state={{ email: form.getValues('email') }} />;
	}

	return (
		<section className="card">
			<h1>{t('auth.login.title')}</h1>

			<form onSubmit={form.handleSubmit(onSubmit)} noValidate>
				<FormError error={normalized} />

				<Field label={t('auth.login.email')} error={form.formState.errors.email?.message}>
					<input type="email" autoComplete="email" {...form.register('email')} />
				</Field>

				<Field label={t('auth.login.password')} error={form.formState.errors.password?.message}>
					<input type="password" autoComplete="current-password" {...form.register('password')} />
				</Field>

				<Submit pending={isLoading}>{t('auth.login.submit')}</Submit>
			</form>

			<p className="muted">
				<Link to="/forgot-password">{t('auth.login.forgot')}</Link> ·{' '}
				<Link to="/signup">{t('auth.login.signupLink')}</Link>
			</p>
		</section>
	);
}
