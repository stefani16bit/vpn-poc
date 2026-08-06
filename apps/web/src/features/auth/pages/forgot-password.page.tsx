import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';

import { forgotPasswordRequestSchema, type ForgotPasswordRequest } from '@vpn/contracts';

import { normalizeError } from '@/app/store/api-error.js';
import { Field } from '@/components/form/field.tsx';
import { FormError } from '@/components/form/form-error.tsx';
import { SubmitButton } from '@/components/form/submit-button.tsx';
import { AuthCard } from '@/components/layout/auth-card.tsx';
import { MessageScreen } from '@/components/layout/message-screen.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useForgotPasswordMutation } from '@/features/auth/api/auth.api.js';
import { useTranslator } from '@/i18n/locale-context.tsx';

export function ForgotPasswordPage() {
	const t = useTranslator();
	const [forgotPassword, { isLoading, error }] = useForgotPasswordMutation();
	const [sent, setSent] = useState(false);

	const form = useForm<ForgotPasswordRequest>({
		resolver: zodResolver(forgotPasswordRequestSchema),
	});

	if (sent) {
		return (
			<MessageScreen title={t('auth.forgotPassword.sentTitle')}>
				<p>{t('auth.forgotPassword.sentBody')}</p>
				<p className="mt-4 text-sm text-muted-foreground">
					{t('auth.forgotPassword.sentExpiry')}{' '}
					<Link to="/login" className="text-primary underline-offset-4 hover:underline">
						{t('common.back')}
					</Link>
				</p>
			</MessageScreen>
		);
	}

	return (
		<AuthCard title={t('auth.forgotPassword.title')}>
			<form
				onSubmit={form.handleSubmit(async (values) => {
					const result = await forgotPassword(values);
					if ('data' in result) setSent(true);
				})}
				noValidate
			>
				<FormError error={normalizeError(error)} />

				<Field label={t('auth.forgotPassword.email')} error={form.formState.errors.email?.message}>
					{(control) => (
						<Input type="email" autoComplete="email" {...control} {...form.register('email')} />
					)}
				</Field>

				<SubmitButton pending={isLoading}>{t('auth.forgotPassword.submit')}</SubmitButton>
			</form>
		</AuthCard>
	);
}
