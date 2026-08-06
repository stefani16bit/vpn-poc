import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeStore, renderWithProviders, stubApi } from '@/test-utils.tsx';
import { useBootstrapAuth } from './use-bootstrap-auth.js';

function Probe() {
	useBootstrapAuth();
	return null;
}

const SESSION = {
	user: {
		id: 'acc-1',
		email: 'ada@example.com',
		emailVerified: true,
		locale: 'en',
		createdAt: '2026-01-01T00:00:00.000Z',
	},
	accessToken: 'access-1',
	expiresIn: 900,
};

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('useBootstrapAuth', () => {
	it('trades the refresh cookie for a session on first mount', async () => {
		const api = stubApi();
		api.reply(SESSION);
		const store = makeStore();

		renderWithProviders(<Probe />, { locale: 'en', store });

		await waitFor(() => expect(store.getState().auth.status).toBe('authenticated'));
		expect(api.lastRequest()?.url).toContain('auth/refresh');
		expect(store.getState().auth.accessToken).toBe('access-1');
	});

	it('asks exactly once, despite StrictMode running the effect twice', async () => {
		const api = stubApi();
		api.reply(SESSION);

		renderWithProviders(<Probe />, { locale: 'en' });

		await waitFor(() => expect(api.requests.length).toBeGreaterThan(0));
		expect(api.requests).toHaveLength(1);
	});

	it('settles on unauthenticated when there is no usable cookie', async () => {
		const api = stubApi();
		api.reply({ code: 'UNAUTHENTICATED' }, 401);
		const store = makeStore();

		renderWithProviders(<Probe />, { locale: 'en', store });

		await waitFor(() => expect(store.getState().auth.status).toBe('unauthenticated'));
	});

	it('settles on unauthenticated when the network is unreachable', async () => {
		vi.stubGlobal('fetch', async () => {
			throw new Error('offline');
		});
		const store = makeStore();

		renderWithProviders(<Probe />, { locale: 'en', store });

		await waitFor(() => expect(store.getState().auth.status).toBe('unauthenticated'));
	});

	it('leaves the status unknown until the answer arrives, so no login flash', () => {
		stubApi().reply(SESSION);
		const store = makeStore();

		renderWithProviders(<Probe />, { locale: 'en', store });

		expect(store.getState().auth.status).toBe('unknown');
	});
});
