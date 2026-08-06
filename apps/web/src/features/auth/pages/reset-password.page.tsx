import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { resetPasswordRequestSchema, type ResetPasswordRequest } from '@vpn/contracts';

import { normalizeError } from '@/app/store/api-error.js';
import { Field } from '@/components/form/field.tsx';
import { FormError } from '@/components/form/form-error.tsx';
import { SubmitButton } from '@/components/form/submit-button.tsx';
import { AuthCard } from '@/components/layout/auth-card.tsx';
import { MessageScreen } from '@/components/layout/message-screen.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useResetPasswordMutation } from '@/features/auth/api/auth.api.js';
import { useTranslator } from '@/i18n/locale-context.tsx';

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
			<MessageScreen title={t('auth.resetPassword.invalidLinkTitle')}>
				<p>{t('auth.resetPassword.invalidLinkBody')}</p>
				<p className="mt-4">
					<Link to="/forgot-password" className="text-primary underline-offset-4 hover:underline">
						{t('auth.resetPassword.requestNew')}
					</Link>
				</p>
			</MessageScreen>
		);
	}

	return (
		<AuthCard title={t('auth.resetPassword.title')}>
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
					{(control) => (
						<Input
							type="password"
							autoComplete="new-password"
							{...control}
							{...form.register('password')}
						/>
					)}
				</Field>

				<p className="mb-4 text-sm text-muted-foreground">{t('auth.resetPassword.warning')}</p>

				<SubmitButton pending={isLoading}>{t('auth.resetPassword.submit')}</SubmitButton>
			</form>
		</AuthCard>
	);
}
