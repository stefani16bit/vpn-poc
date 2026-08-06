import { Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { useTranslator } from '@/i18n/locale-context.tsx';
import { useTheme } from './theme-provider.tsx';

export function ThemeToggle(): ReactNode {
	const t = useTranslator();
	const { theme, setTheme } = useTheme();

	const next = theme === 'dark' ? 'light' : 'dark';

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			aria-label={`${t('common.theme')}: ${t(next === 'dark' ? 'common.themeDark' : 'common.themeLight')}`}
			onClick={() => setTheme(next)}
		>
			{theme === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}
		</Button>
	);
}
