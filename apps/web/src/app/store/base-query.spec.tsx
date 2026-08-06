import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeStore, renderWithProviders } from '@/test-utils.tsx';
import { useSubscriptionQuery } from '@/features/billing/api/billing.api.js';
import { sessionResolved } from './auth-slice.js';

function Probe() {
	useSubscriptionQuery();
	return null;
}

const SESSION = {
	user: {
		id: 'acc-1',
		email: 'ada@example.com',
		emailVerified: true,
		locale: 'en' as const,
		createdAt: '2026-01-01T00:00:00.000Z',
	},
	accessToken: 'fresh-token',
	expiresIn: 900,
};

const SUBSCRIPTION = { status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false };

interface Call {
	readonly url: string;
	readonly authorization: string | null;
}

function scriptedFetch(plan: (call: number, url: string) => { status: number; body: unknown }) {
	const calls: Call[] = [];

	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		calls.push({ url: request.url, authorization: request.headers.get('authorization') });

		const { status, body } = plan(calls.length, request.url);
		return new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' },
		});
	});

	return calls;
}

function signedIn() {
	const store = makeStore();
	store.dispatch(sessionResolved({ user: SESSION.user, accessToken: 'stale-token' }));
	return store;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('baseQueryWithRefresh', () => {
	it('sends the access token and the stored locale', async () => {
		const calls = scriptedFetch(() => ({ status: 200, body: SUBSCRIPTION }));
		renderWithProviders(<Probe />, { locale: 'en', store: signedIn() });

		await waitFor(() => expect(calls.length).toBeGreaterThan(0));
		expect(calls[0]?.authorization).toBe('Bearer stale-token');
	});

	it('refreshes once on a 401 and retries with the new token', async () => {
		const calls = scriptedFetch((call, url) => {
			if (url.includes('auth/refresh')) return { status: 200, body: SESSION };
			return call === 1
				? { status: 401, body: { code: 'TOKEN_EXPIRED', correlationId: 'c' } }
				: { status: 200, body: SUBSCRIPTION };
		});
		const store = signedIn();

		renderWithProviders(<Probe />, { locale: 'en', store });

		await waitFor(() => expect(store.getState().auth.accessToken).toBe('fresh-token'));
		expect(calls.map((c) => c.url.includes('auth/refresh'))).toEqual([false, true, false]);
		expect(calls.at(-1)?.authorization).toBe('Bearer fresh-token');
	});

	it('clears the session when the refresh itself is rejected', async () => {
		scriptedFetch((_call, url) =>
			url.includes('auth/refresh')
				? { status: 401, body: { code: 'UNAUTHENTICATED', correlationId: 'c' } }
				: { status: 401, body: { code: 'TOKEN_EXPIRED', correlationId: 'c' } },
		);
		const store = signedIn();

		renderWithProviders(<Probe />, { locale: 'en', store });

		await waitFor(() => expect(store.getState().auth.status).toBe('unauthenticated'));
	});

	it('does not try to refresh a failing auth route, which would recurse', async () => {
		const calls = scriptedFetch(() => ({
			status: 401,
			body: { code: 'INVALID_CREDENTIALS', correlationId: 'c' },
		}));
		const store = signedIn();

		renderWithProviders(<Probe />, { locale: 'en', store });

		await waitFor(() => expect(calls.length).toBeGreaterThan(1));
		expect(calls.filter((c) => c.url.includes('auth/refresh'))).toHaveLength(1);
	});
});
