import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionResolved } from '@/app/store/auth-slice.js';
import {
	makeStore,
	renderWithProviders,
	stubApi,
	type ApiStub,
	type TestStore,
} from '@/test-utils.tsx';
import { CheckoutCancelPage } from './checkout-cancel.page.tsx';

let api: ApiStub;

beforeEach(() => {
	api = stubApi();
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

function render() {
	return renderWithProviders(<CheckoutCancelPage />, {
		locale: 'en',
		route: '/billing/cancel',
		store: signedIn(),
	});
}

describe('CheckoutCancelPage', () => {
	it('says nothing was charged', async () => {
		render();

		expect(await screen.findByText('Nothing was charged')).toBeInTheDocument();
		expect(
			screen.getByText(
				'You left the checkout before finishing. Your subscription has not changed.',
			),
		).toBeInTheDocument();
	});

	it('offers both plans again', async () => {
		render();

		expect(await screen.findByRole('button', { name: /monthly/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /yearly/i })).toBeInTheDocument();
	});

	it('reads no subscription, because nothing about it changed', async () => {
		render();

		await screen.findByRole('button', { name: /monthly/i });
		expect(api.requests).toHaveLength(0);
	});

	it('sends the browser back to the checkout url the API returned', async () => {
		const assign = vi.fn();
		vi.stubGlobal('location', { ...window.location, assign });
		render();

		api.reply({ checkoutUrl: 'https://checkout.example/session' });
		await userEvent.click(await screen.findByRole('button', { name: /yearly/i }));

		await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.example/session'));
		expect(api.lastRequest()?.body).toEqual({ tier: 'pro', cadence: 'yearly' });
	});

	it('surfaces a failure to start a new checkout', async () => {
		render();

		const monthly = await screen.findByRole('button', { name: /monthly/i });
		api.fail('PAYMENT_REQUIRED', 402);
		await userEvent.click(monthly);

		expect(await screen.findByRole('alert')).toHaveTextContent('corr-test');
	});
});
