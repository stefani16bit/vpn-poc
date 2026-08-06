import { BrowserRouter } from 'react-router-dom';

import { useBootstrapAuth } from '@/features/auth/hooks/use-bootstrap-auth.js';
import { useTranslator } from '@/i18n/locale-context.tsx';
import { ThemeToggle } from '@/theme/theme-toggle.tsx';
import { Router } from './router.tsx';

export function App() {
	const t = useTranslator();
	useBootstrapAuth();

	return (
		<BrowserRouter>
			<a
				href="#main"
				className="sr-only bg-background focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:px-3 focus:py-2 focus:ring-2 focus:ring-ring"
			>
				{t('common.skipToContent')}
			</a>

			<div className="flex justify-end p-4">
				<ThemeToggle />
			</div>

			<main id="main" className="flex justify-center px-4 pb-12">
				<Router />
			</main>
		</BrowserRouter>
	);
}
