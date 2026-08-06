import type { ReactNode } from 'react';

import type { NormalizedError } from '@/app/store/api-error.js';
import { useTranslator } from '@/i18n/locale-context.js';

export function Field({
	label,
	error,
	children,
}: {
	label: string;
	error?: string | undefined;
	children: ReactNode;
}): ReactNode {
	const t = useTranslator();

	return (
		<label className="field">
			<span className="field-label">{label}</span>
			{children}
			{error ? (
				<span className="field-error" role="alert">
					{t(error as never)}
				</span>
			) : null}
		</label>
	);
}

export function FormError({ error }: { error: NormalizedError | null }): ReactNode {
	const t = useTranslator();
	if (!error || error.code === 'VALIDATION_FAILED') return null;

	return (
		<div className="form-error" role="alert">
			<p>{t(`errors.${error.code}` as never)}</p>
			{error.correlationId ? (
				<p className="muted small">
					{t('common.errorCode')}: {error.correlationId}
				</p>
			) : null}
		</div>
	);
}

export function Submit({ pending, children }: { pending: boolean; children: ReactNode }): ReactNode {
	const t = useTranslator();

	return (
		<button type="submit" className="primary" disabled={pending}>
			{pending ? t('common.wait') : children}
		</button>
	);
}
