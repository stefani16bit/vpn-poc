import { configureStore } from '@reduxjs/toolkit';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import type { AnyErrorCode, SupportedLocale } from '@vpn/contracts';

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

export interface RecordedRequest {
	readonly url: string;
	readonly method: string;
	readonly body: unknown;
	readonly headers: Headers;
}

export interface ApiStub {
	readonly requests: RecordedRequest[];
	reply(body: unknown, status?: number): void;
	fail(code: AnyErrorCode, status: number): void;
	lastRequest(): RecordedRequest | undefined;
}

export function stubApi(): ApiStub {
	const requests: RecordedRequest[] = [];
	let nextStatus = 200;
	let nextBody: unknown = {};

	const stub: ApiStub = {
		requests,
		reply(body, status = 200) {
			nextBody = body;
			nextStatus = status;
		},
		// normalizeError only trusts a body carrying a string correlationId, which
		// the API's exception filter always sends; omitting it here would make
		// every failure read as _UNKNOWN_ERROR and the assertion pass for nothing.
		fail(code, status) {
			nextBody = { code, message: `${code} (developer detail)`, correlationId: 'corr-test' };
			nextStatus = status;
		},
		lastRequest() {
			return requests.at(-1);
		},
	};

	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		requests.push({
			url: request.url,
			method: request.method,
			body: await request
				.clone()
				.json()
				.catch(() => null),
			headers: request.headers,
		});

		return new Response(JSON.stringify(nextBody), {
			status: nextStatus,
			headers: { 'content-type': 'application/json' },
		});
	});

	return stub;
}
