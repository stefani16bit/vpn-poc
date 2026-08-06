import { configureStore } from '@reduxjs/toolkit';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';

import type { SupportedLocale } from '@vpn/contracts';

import { api } from '@/app/store/api.js';
import { rootReducer } from '@/app/store/index.js';
import { LocaleProvider } from '@/i18n/locale-context.tsx';

export type TestStore = ReturnType<typeof makeStore>;

// The real store adds cross-tab sync, which needs a BroadcastChannel and would
// leak state between tests. Everything else is the production wiring.
export function makeStore() {
	return configureStore({
		reducer: rootReducer,
		middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(api.middleware),
	});
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
	readonly store?: TestStore;
	readonly route?: string;
	readonly locale?: SupportedLocale;
}

export function renderWithProviders(
	ui: ReactElement,
	options: RenderWithProvidersOptions = {},
): RenderResult & { store: TestStore } {
	const { store = makeStore(), route = '/', locale, ...rest } = options;

	if (locale) {
		try {
			window.localStorage.setItem('poc-vpn.locale', locale);
		} catch {
			// a storage-less browser falls back to negotiation, same as production
		}
	}

	function Wrapper({ children }: { children: ReactNode }) {
		return (
			<Provider store={store}>
				<LocaleProvider>
					<MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
				</LocaleProvider>
			</Provider>
		);
	}

	return { store, ...render(ui, { wrapper: Wrapper, ...rest }) };
}
