import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ENTITLEMENTS, PLAN_PRICES } from '@vpn/contracts';

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

		// Once per cadence card: the two cadences buy the same plan, and a card
		// that omitted the limits would read as the cheaper tier of a lineup.
		expect(screen.getAllByText(`${ENTITLEMENTS.pro.seats} users`)).toHaveLength(2);
		expect(screen.getAllByText(`${ENTITLEMENTS.pro.devicesPerUser} devices per user`)).toHaveLength(
			2,
		);
		expect(
			screen.getAllByText(`${ENTITLEMENTS.pro.monthlyTrafficGb} GB of traffic per month`),
		).toHaveLength(2);
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

	it('lets the header jump to the two sections the page is made of', () => {
		render(signedOut());

		const header = within(screen.getByRole('banner'));

		expect(header.getByRole('link', { name: 'Product' })).toHaveAttribute('href', '#product');
		expect(header.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '#pricing');
	});

	it('keeps language and theme in its own header, having left the app frame behind', () => {
		render(signedOut());

		const header = within(screen.getByRole('banner'));

		expect(header.getByRole('combobox', { name: 'Language' })).toBeInTheDocument();
		expect(header.getByRole('button', { name: /Theme/ })).toBeInTheDocument();
	});

	it('offers a way down to the prices next to the call to action', () => {
		render(signedOut());

		expect(screen.getByRole('link', { name: 'See pricing' })).toHaveAttribute('href', '#pricing');
	});

	it('marks the yearly card as the better buy, in months read off the price map', () => {
		render(signedOut());

		const { monthly, yearly } = PLAN_PRICES.pro;
		const months = Math.round(
			(monthly.amountCents * 12 - yearly.amountCents) / monthly.amountCents,
		);

		expect(screen.getByText('Best value')).toBeInTheDocument();
		expect(screen.getByText(`${months} months free`)).toBeInTheDocument();
	});

	it('names each cadence card, so a price is never a number on its own', () => {
		render(signedOut());

		expect(screen.getByRole('heading', { name: 'Monthly' })).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Yearly' })).toBeInTheDocument();
	});

	it('closes with a footer that repeats the way back up', () => {
		render(signedOut());

		const footer = within(screen.getByRole('contentinfo'));

		expect(footer.getByText(`© ${new Date().getFullYear()} poc-vpn`)).toBeInTheDocument();
		expect(footer.getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '#pricing');
	});
});
