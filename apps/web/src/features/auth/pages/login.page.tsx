import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useDispatch } from 'react-redux';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import { loginRequestSchema, type LoginRequest } from '@vpn/contracts';

import { normalizeError } from '@/app/store/api-error.js';
import { sessionResolved } from '@/app/store/auth-slice.js';
import type { AppDispatch } from '@/app/store/index.js';
import { Field } from '@/components/form/field.tsx';
import { FormError } from '@/components/form/form-error.tsx';
import { SubmitButton } from '@/components/form/submit-button.tsx';
import { AuthCard } from '@/components/layout/auth-card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useLoginMutation } from '@/features/auth/api/auth.api.js';
import { useTranslator } from '@/i18n/locale-context.tsx';

export function LoginPage() {
	const t = useTranslator();
	const dispatch = useDispatch<AppDispatch>();
	const navigate = useNavigate();
	const location = useLocation();
	const [login, { isLoading, error }] = useLoginMutation();

	const form = useForm<LoginRequest>({ resolver: zodResolver(loginRequestSchema) });
	const normalized = normalizeError(error);

	const from = (location.state as { from?: string } | null)?.from ?? '/account';

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
		<AuthCard title={t('auth.login.title')}>
			<form onSubmit={form.handleSubmit(onSubmit)} noValidate>
				<FormError error={normalized} />

				<Field label={t('auth.login.email')} error={form.formState.errors.email?.message}>
					{(control) => (
						<Input type="email" autoComplete="email" {...control} {...form.register('email')} />
					)}
				</Field>

				<Field label={t('auth.login.password')} error={form.formState.errors.password?.message}>
					{(control) => (
						<Input
							type="password"
							autoComplete="current-password"
							{...control}
							{...form.register('password')}
						/>
					)}
				</Field>

				<SubmitButton pending={isLoading}>{t('auth.login.submit')}</SubmitButton>
			</form>

			<p className="mt-4 text-sm text-muted-foreground">
				<Link to="/forgot-password" className="text-primary underline-offset-4 hover:underline">
					{t('auth.login.forgot')}
				</Link>{' '}
				·{' '}
				<Link to="/signup" className="text-primary underline-offset-4 hover:underline">
					{t('auth.login.signupLink')}
				</Link>
			</p>
		</AuthCard>
	);
}
