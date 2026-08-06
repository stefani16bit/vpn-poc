import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { resetPasswordRequestSchema, type ResetPasswordRequest } from '@vpn/contracts';

import { normalizeError } from '@/app/store/api-error.js';
import { useResetPasswordMutation } from '@/features/auth/api/auth.api.js';
import { useTranslator } from '@/i18n/locale-context.js';
import { Field, FormError, Submit } from '@/ui/form.tsx';

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
