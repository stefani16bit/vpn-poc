import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionCleared, sessionResolved } from '@/app/store/auth-slice.js';
import {
	makeStore,
	renderWithProviders,
	stubApi,
	type ApiStub,
	type TestStore,
} from '@/test-utils.tsx';
import { Router } from './router.tsx';

let api: ApiStub;

beforeEach(() => {
	api = stubApi();
	api.reply({ status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false });
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function signedIn(): TestStore {
	const store = makeStore();
	store.dispatch(
		sessionResolved({
			user: {
				id: 'user-1',
				accountId: 'account-1',
				role: 'owner' as const,
				email: 'ada@example.com',
				emailVerified: true,
				locale: 'en',
				createdAt: '2026-01-01T00:00:00.000Z',
			},
			accessToken: 'access-1',
		}),
	);
	return store;
}

function renderAt(route: string) {
	return renderWithProviders(<Router />, { locale: 'en', route, store: signedIn() });
}

describe('Router', () => {
	it('lands the checkout return on its own page instead of the account page', async () => {
		renderAt('/billing/success');

		expect(await screen.findByText('Payment received')).toBeInTheDocument();
	});

	it('lands a cancelled checkout on its own page', async () => {
		renderAt('/billing/cancel');

		expect(await screen.findByText('Nothing was charged')).toBeInTheDocument();
	});

	it('still sends an unknown billing subpath to the account page', async () => {
		renderAt('/billing/whatever');

		expect(await screen.findByText('Your account')).toBeInTheDocument();
	});

	it('still sends an unknown path to the account page', async () => {
		renderAt('/somewhere-else');

		expect(await screen.findByText('Your account')).toBeInTheDocument();
	});

	it('sends a signed-out visitor from the checkout return to the login screen', async () => {
		const store = makeStore();
		store.dispatch(sessionCleared());

		renderWithProviders(<Router />, { locale: 'en', route: '/billing/success', store });

		expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
	});
});
