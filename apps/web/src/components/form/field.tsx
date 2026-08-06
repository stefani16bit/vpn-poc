import { useId, type ReactNode } from 'react';

import { Label } from '@/components/ui/label.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';

export interface FieldControlProps {
	readonly id: string;
	readonly 'aria-invalid': boolean;
	readonly 'aria-describedby': string | undefined;
}

export function Field({
	label,
	error,
	children,
}: {
	label: string;
	error?: string | undefined;
	children: (control: FieldControlProps) => ReactNode;
}): ReactNode {
	const t = useTranslator();
	const id = useId();
	const errorId = `${id}-error`;

	return (
		<div className="mb-4 grid gap-2">
			<Label htmlFor={id}>{label}</Label>

			{children({
				id,
				'aria-invalid': Boolean(error),
				'aria-describedby': error ? errorId : undefined,
			})}

			{error ? (
				<p id={errorId} role="alert" className="text-sm text-destructive">
					{t(error as never)}
				</p>
			) : null}
		</div>
	);
}
