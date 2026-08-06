import { useLocale } from './locale-context.js';
import { RESOURCES } from '@vpn/i18n';

export function LanguagePicker() {
	const { locale, setLocale, available, t } = useLocale();

	return (
		<label className="language-picker">
			<span className="muted small">{t('common.language')}</span>
			<select
				value={locale}
				onChange={(event) => setLocale(event.target.value as typeof locale)}
			>
				{available.map((candidate) => (
					<option key={candidate} value={candidate}>
						{RESOURCES[candidate].common.languageName}
					</option>
				))}
			</select>
		</label>
	);
}
