import type { ReactNode } from 'react';

import type { NormalizedError } from '@/app/store/api-error.js';
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

export function FormError({ error }: { error: NormalizedError | null }): ReactNode {
	const t = useTranslator();

	// A field-level failure is already rendered next to each field; repeating it
	// at the top of the form says nothing new.
	if (!error || error.code === 'VALIDATION_FAILED') return null;

	// The catalog copy for a 429 cannot name a window, because the four rules
	// have two different ones. When the server says how long, the screen says it.
	const message =
		error.code === 'RATE_LIMITED' && error.retryAfterSeconds !== null
			? t('common.retryInMinutes', {
					minutes: Math.max(1, Math.ceil(error.retryAfterSeconds / 60)),
				})
			: t(`errors.${error.code}` as never);

	return (
		<Alert variant="destructive" className="mb-4">
			<AlertDescription>
				<p>{message}</p>
				{error.correlationId ? (
					<p className="text-sm text-muted-foreground">
						{t('common.errorCode')}: {error.correlationId}
					</p>
				) : null}
			</AlertDescription>
		</Alert>
	);
}
