import type { ReactNode } from 'react';
import { Provider } from 'react-redux';

import { LocaleProvider } from '@/i18n/locale-context.tsx';
import { ThemeProvider } from '@/theme/theme-provider.tsx';
import { ErrorBoundary } from './error-boundary.tsx';
import { store } from './store/index.js';

export function Providers({ children }: { children: ReactNode }): ReactNode {
	return (
		<ErrorBoundary>
			<Provider store={store}>
				<LocaleProvider>
					<ThemeProvider>{children}</ThemeProvider>
				</LocaleProvider>
			</Provider>
		</ErrorBoundary>
	);
}
