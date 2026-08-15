import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ENTITLEMENTS } from '@vpn/contracts';

import { sessionCleared, sessionResolved } from '@/app/store/auth-slice.js';
import { makeStore, renderWithProviders, stubApi, type TestStore } from '@/test-utils.tsx';
import { LandingPage } from './landing.page.tsx';

beforeEach(() => {
	stubApi();
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

function signedOut(): TestStore {
	const store = makeStore();
	store.dispatch(sessionCleared());
	return store;
}

function render(store: TestStore) {
	return renderWithProviders(<LandingPage />, { locale: 'en', route: '/', store });
}

describe('LandingPage', () => {
	it('leads with what the product is', () => {
		render(signedOut());

		expect(
			screen.getByRole('heading', { name: 'A WireGuard tunnel your company runs' }),
		).toBeInTheDocument();
	});

	it('says the three things that make it worth paying for', () => {
		render(signedOut());

		expect(
			screen.getByRole('heading', { name: 'The private key never leaves the browser' }),
		).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'One company, many people' })).toBeInTheDocument();
		expect(
			screen.getByRole('heading', { name: 'Pick where your traffic leaves' }),
		).toBeInTheDocument();
	});

	it('prints both prices, formatted in the currency the card is charged in', () => {
		render(signedOut());

		expect(screen.getByText(/R\$\s?29\.90\/month/)).toBeInTheDocument();
		expect(screen.getByText(/R\$\s?299\.00\/year/)).toBeInTheDocument();
	});

	it('reads the plan limits off the shared map rather than restating them', () => {
		render(signedOut());

		expect(screen.getByText(`${ENTITLEMENTS.pro.seats} users`)).toBeInTheDocument();
		expect(
			screen.getByText(`${ENTITLEMENTS.pro.devicesPerUser} devices per user`),
		).toBeInTheDocument();
		expect(
			screen.getByText(`${ENTITLEMENTS.pro.monthlyTrafficGb} GB of traffic per month`),
		).toBeInTheDocument();
	});

	it('offers signing in as plainly as signing up, since an existing address gets no link', () => {
		render(signedOut());

		expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
		expect(screen.getAllByRole('link', { name: 'Create an account' })[0]).toHaveAttribute(
			'href',
			'/signup',
		);
	});

	it('shows an anonymous reader the call to action while the session is still unknown', () => {
		render(makeStore());

		expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
		expect(screen.queryByRole('status')).not.toBeInTheDocument();
	});

	it('points a visitor who already has a session at the account page', () => {
		render(signedIn());

		expect(screen.getByRole('link', { name: 'Your account' })).toHaveAttribute('href', '/account');
		expect(screen.queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
	});

	it('sends a visitor with no account to signup, where a plan can be bought later', () => {
		render(signedOut());

		expect(screen.getByRole('link', { name: 'Start monthly' })).toHaveAttribute('href', '/signup');
		expect(screen.getByRole('link', { name: 'Start yearly' })).toHaveAttribute('href', '/signup');
	});

	it('sends a signed-in visitor picking a plan to the account page instead of signup', () => {
		render(signedIn());

		expect(screen.getByRole('link', { name: 'Start monthly' })).toHaveAttribute('href', '/account');
	});
});
