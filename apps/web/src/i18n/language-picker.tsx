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

export function LanguagePicker() {
	const { locale, setLocale, available, t } = useLocale();
	const id = useId();

	return (
		<div className="mt-4 grid gap-2">
			<Label htmlFor={id} className="text-sm text-muted-foreground">
				{t('common.language')}
			</Label>

			<Select value={locale} onValueChange={(next) => setLocale(next as typeof locale)}>
				<SelectTrigger id={id} className="w-full">
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
		</div>
	);
}
