import { configureStore } from '@reduxjs/toolkit';
import { render, type RenderOptions, type RenderResult } from '@testing-library/react';
import { StrictMode, type ReactElement, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

import {
	ENTITLEMENTS,
	PERMISSIONS,
	UNSUBSCRIBED_ENTITLEMENTS,
	type AnyErrorCode,
	type Permission,
	type SupportedLocale,
	type TierId,
} from '@vpn/contracts';

import { api } from '@/app/store/api.js';
import { clearApiCacheMiddleware, rootReducer } from '@/app/store/index.js';
import { LocaleProvider } from '@/i18n/locale-context.tsx';
import { ThemeProvider } from '@/theme/theme-provider.tsx';

export type TestStore = ReturnType<typeof makeStore>;

// The real store adds two things this one leaves out: cross-tab sync, which
// needs a BroadcastChannel and would leak state between tests, and the action
// logger, which would print a group per action across the whole suite.
// Everything else is the production wiring.
export function makeStore() {
	return configureStore({
		reducer: rootReducer,
		middleware: (getDefaultMiddleware) =>
			getDefaultMiddleware().prepend(clearApiCacheMiddleware).concat(api.middleware),
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
			<StrictMode>
				<Provider store={store}>
					<LocaleProvider>
						<ThemeProvider>
							<MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
						</ThemeProvider>
					</LocaleProvider>
				</Provider>
			</StrictMode>
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
	grant(...permissions: Permission[]): void;
	// The one read that has to keep working for the app to draw anything. It is
	// separate from fail() because every screen asks it, and a test about a
	// broken login is not a test about a broken authorization read.
	breakGrants(): void;
	subscribe(tier: TierId | null): void;
	lastRequest(): RecordedRequest | undefined;
}

export interface SlowApiStub {
	readonly requests: string[];
	readonly aborted: string[];
	release(): void;
}

// A request that is still in flight is the only way to observe a teardown
// aborting it, which is what a resolved-on-call stub can never show.
export function stubSlowApi(body: unknown = { acknowledged: true }, status = 200): SlowApiStub {
	const requests: string[] = [];
	const aborted: string[] = [];

	let open!: () => void;
	const gate = new Promise<void>((resolve) => {
		open = resolve;
	});

	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		requests.push(request.url);

		await gate;

		if (request.signal?.aborted) {
			aborted.push(request.url);
			throw Object.assign(new Error('aborted'), { name: 'AbortError' });
		}

		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' },
		});
	});

	return { requests, aborted, release: () => open() };
}

// Every authenticated screen asks what the caller may do and what the company
// bought, so the stub answers those two by route instead of by turn. The
// defaults are everything and subscribed: a test that is not about
// authorization or billing should not have to opt into being allowed.
export function stubApi(): ApiStub {
	const requests: RecordedRequest[] = [];
	let nextStatus = 200;
	let nextBody: unknown = {};
	let granted: readonly Permission[] = PERMISSIONS;
	let grantsBroken = false;
	let tier: TierId | null = 'pro';

	const stub: ApiStub = {
		requests,
		reply(body, status = 200) {
			nextBody = body;
			nextStatus = status;
		},
		grant(...permissions) {
			granted = permissions;
		},
		breakGrants() {
			grantsBroken = true;
		},
		subscribe(next) {
			tier = next;
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

		const path = new URL(request.url).pathname;

		if (request.method === 'GET' && path.endsWith('/permissions')) {
			const body = grantsBroken
				? { code: 'INTERNAL', message: 'INTERNAL (developer detail)', correlationId: 'corr-test' }
				: { permissions: granted };

			return new Response(JSON.stringify(body), {
				status: grantsBroken ? 500 : 200,
				headers: { 'content-type': 'application/json' },
			});
		}

		if (request.method === 'GET' && path.endsWith('/entitlements')) {
			const body = {
				tier,
				entitlements: tier === null ? UNSUBSCRIBED_ENTITLEMENTS : ENTITLEMENTS[tier],
			};

			return new Response(JSON.stringify(body), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		}

		return new Response(JSON.stringify(nextBody), {
			status: nextStatus,
			headers: { 'content-type': 'application/json' },
		});
	});

	return stub;
}
