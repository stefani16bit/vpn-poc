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

	it('gives the account page an address of its own, now that / is public', async () => {
		renderAt('/account');

		expect(await screen.findByText('Your account')).toBeInTheDocument();
	});

	it('still sends an unknown billing subpath to the account page', async () => {
		renderAt('/billing/whatever');

		expect(await screen.findByText('Your account')).toBeInTheDocument();
	});

	it('still sends an unknown path to the account page', async () => {
		renderAt('/somewhere-else');

		expect(await screen.findByText('Your account')).toBeInTheDocument();
	});

	it('reaches the keys page, which nothing else links to from a fresh session', async () => {
		stubApi().reply({ devices: [], node: { publicKey: 'k', endpoint: 'e', allowedIps: ['1/32'] } });
		renderAt('/keys');

		expect(await screen.findByText('Devices and keys')).toBeInTheDocument();
	});

	it('gives the landing the whole page, with no app frame around it', () => {
		renderAt('/');

		expect(screen.getByRole('contentinfo')).toBeInTheDocument();
		expect(screen.getAllByRole('main')).toHaveLength(1);
	});

	it('frames every other route, and never stacks a second main landmark', async () => {
		renderAt('/account');

		expect(await screen.findByText('Your account')).toBeInTheDocument();
		expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
		expect(screen.getAllByRole('main')).toHaveLength(1);
	});

	it('sends a signed-out visitor from the checkout return to the login screen', async () => {
		const store = makeStore();
		store.dispatch(sessionCleared());

		renderWithProviders(<Router />, { locale: 'en', route: '/billing/success', store });

		expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
	});
});
