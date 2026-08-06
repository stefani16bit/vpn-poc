import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';

import { registerRequestSchema, type RegisterRequest } from '@vpn/contracts';

import { normalizeError } from '@/app/store/api-error.js';
import { Field } from '@/components/form/field.tsx';
import { FormError } from '@/components/form/form-error.tsx';
import { SubmitButton } from '@/components/form/submit-button.tsx';
import { AuthCard } from '@/components/layout/auth-card.tsx';
import { MessageScreen } from '@/components/layout/message-screen.tsx';
import { Input } from '@/components/ui/input.tsx';
import { useRegisterMutation } from '@/features/auth/api/auth.api.js';
import { useLocale } from '@/i18n/locale-context.tsx';

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
			<MessageScreen title={t('auth.signup.checkInboxTitle')}>
				<p>{t('auth.signup.checkInboxBody', { email: submittedTo })}</p>
				<p className="mt-4 text-sm text-muted-foreground">
					{t('auth.signup.checkInboxExpiry')}{' '}
					<Link to="/login" className="text-primary underline-offset-4 hover:underline">
						{t('auth.signup.loginLink')}
					</Link>
				</p>
			</MessageScreen>
		);
	}

	return (
		<AuthCard title={t('auth.signup.title')}>
			<form onSubmit={form.handleSubmit(onSubmit)} noValidate>
				<FormError error={normalizeError(error)} />

				<Field label={t('auth.signup.email')} error={form.formState.errors.email?.message}>
					{(control) => (
						<Input type="email" autoComplete="email" {...control} {...form.register('email')} />
					)}
				</Field>

				<Field label={t('auth.signup.password')} error={form.formState.errors.password?.message}>
					{(control) => (
						<Input
							type="password"
							autoComplete="new-password"
							{...control}
							{...form.register('password')}
						/>
					)}
				</Field>

				<p className="mb-4 text-sm text-muted-foreground">{t('auth.signup.passwordHint')}</p>

				<SubmitButton pending={isLoading}>{t('auth.signup.submit')}</SubmitButton>
			</form>

			<p className="mt-4 text-sm text-muted-foreground">
				{t('auth.signup.haveAccount')}{' '}
				<Link to="/login" className="text-primary underline-offset-4 hover:underline">
					{t('auth.signup.loginLink')}
				</Link>
			</p>
		</AuthCard>
	);
}
