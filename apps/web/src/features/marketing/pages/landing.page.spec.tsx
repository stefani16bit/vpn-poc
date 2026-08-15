import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ENTITLEMENTS } from '@vpn/contracts';

import { sessionCleared, sessionResolved } from '@/app/store/auth-slice.js';
import { readIntendedCadence } from '@/lib/intended-cadence.js';
import { makeStore, renderWithProviders, stubApi, type TestStore } from '@/test-utils.tsx';
import { LandingPage } from './landing.page.tsx';

beforeEach(() => {
	stubApi();
	window.localStorage.clear();
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

	it('remembers the cadence clicked by a visitor with no account yet', async () => {
		render(signedOut());

		await userEvent.click(screen.getByRole('link', { name: 'Start yearly' }));

		expect(readIntendedCadence()).toBe('yearly');
	});

	it('sends a signed-in visitor picking a plan to the account page instead of signup', async () => {
		render(signedIn());

		const monthly = screen.getByRole('link', { name: 'Start monthly' });
		expect(monthly).toHaveAttribute('href', '/account');

		await userEvent.click(monthly);

		expect(readIntendedCadence()).toBe('monthly');
	});

	it('sends a visitor with no account to signup, where the choice waits for them', () => {
		render(signedOut());

		expect(screen.getByRole('link', { name: 'Start monthly' })).toHaveAttribute('href', '/signup');
		expect(screen.getByRole('link', { name: 'Start yearly' })).toHaveAttribute('href', '/signup');
	});
});
