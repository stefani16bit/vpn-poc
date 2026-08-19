import { useId } from 'react';

import { RESOURCES } from '@vpn/i18n';

import { Label } from '@/components/ui/label.tsx';
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select.tsx';
import { useLocale } from './locale-context.tsx';

export function LanguagePicker({ compact = false }: { compact?: boolean }) {
	const { locale, setLocale, available, t } = useLocale();
	const id = useId();

	const select = (
		<Select value={locale} onValueChange={(next) => setLocale(next as typeof locale)}>
			<SelectTrigger
				id={compact ? undefined : id}
				aria-label={compact ? t('common.language') : undefined}
				size={compact ? 'sm' : 'default'}
				className={compact ? undefined : 'w-full'}
			>
				<SelectValue />
			</SelectTrigger>

			<SelectContent>
				{available.map((candidate) => (
					<SelectItem key={candidate} value={candidate}>
						{RESOURCES[candidate].common.languageName}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);

	if (compact) return select;

	return (
		<div className="mt-4 grid gap-2">
			<Label htmlFor={id} className="text-sm text-muted-foreground">
				{t('common.language')}
			</Label>

			{select}
		</div>
	);
}
