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
import { BillingPage } from './billing.page.tsx';

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
				id: 'acc-1',
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

describe('BillingPage', () => {
	it('shows the signed-in address', async () => {
		api.reply({ status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false });
		renderWithProviders(<BillingPage />, { locale: 'en', store: signedIn() });

		expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
	});

	it('offers both plans when there is no subscription', async () => {
		api.reply({ status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false });
		renderWithProviders(<BillingPage />, { locale: 'en', store: signedIn() });

		expect(await screen.findByRole('button', { name: /monthly/i })).toBeInTheDocument();
		expect(screen.getByRole('button', { name: /yearly/i })).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
	});

	it('offers both plans again once a subscription is canceled', async () => {
		api.reply({ status: 'canceled', currentPeriodEnd: null, cancelAtPeriodEnd: false });
		renderWithProviders(<BillingPage />, { locale: 'en', store: signedIn() });

		expect(await screen.findByRole('button', { name: /monthly/i })).toBeInTheDocument();
	});

	it('offers cancellation while the subscription is active', async () => {
		api.reply({
			status: 'active',
			currentPeriodEnd: '2026-09-01T00:00:00.000Z',
			cancelAtPeriodEnd: false,
		});
		renderWithProviders(<BillingPage />, { locale: 'en', store: signedIn() });

		expect(await screen.findByRole('button', { name: /cancel/i })).toBeEnabled();
		expect(screen.queryByRole('button', { name: /monthly/i })).not.toBeInTheDocument();
	});

	it('offers a way back when a cancellation is already scheduled', async () => {
		api.reply({
			status: 'active',
			currentPeriodEnd: '2026-09-01T00:00:00.000Z',
			cancelAtPeriodEnd: true,
		});
		renderWithProviders(<BillingPage />, { locale: 'en', store: signedIn() });

		expect(
			await screen.findByText(
				'Cancellation is scheduled. Access continues until the end of the paid period.',
			),
		).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Resume subscription' })).toBeEnabled();
		expect(screen.queryByRole('button', { name: /cancel/i })).not.toBeInTheDocument();
	});

	it('asks the API to resume, and stops saying the cancellation is scheduled', async () => {
		api.reply({
			status: 'active',
			currentPeriodEnd: '2026-09-01T00:00:00.000Z',
			cancelAtPeriodEnd: true,
		});
		renderWithProviders(<BillingPage />, { locale: 'en', store: signedIn() });

		const resume = await screen.findByRole('button', { name: 'Resume subscription' });
		api.reply({
			status: 'active',
			currentPeriodEnd: '2026-09-01T00:00:00.000Z',
			cancelAtPeriodEnd: false,
		});
		await userEvent.click(resume);

		await waitFor(() =>
			expect(
				screen.queryByText(
					'Cancellation is scheduled. Access continues until the end of the paid period.',
				),
			).not.toBeInTheDocument(),
		);
		expect(
			api.requests.some(
				(request) =>
					request.method === 'POST' && request.url.endsWith('billing/subscription/resume'),
			),
		).toBe(true);
	});

	it('does not cancel anything until the confirmation is accepted', async () => {
		api.reply({
			status: 'active',
			currentPeriodEnd: '2026-09-01T00:00:00.000Z',
			cancelAtPeriodEnd: false,
		});
		renderWithProviders(<BillingPage />, { locale: 'en', store: signedIn() });

		await userEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }));
		await screen.findByRole('alertdialog');
		await userEvent.click(screen.getByRole('button', { name: 'Keep my subscription' }));

		expect(api.requests.every((request) => request.method !== 'DELETE')).toBe(true);
	});

	it('cancels once the confirmation is accepted', async () => {
		api.reply({
			status: 'active',
			currentPeriodEnd: '2026-09-01T00:00:00.000Z',
			cancelAtPeriodEnd: false,
		});
		renderWithProviders(<BillingPage />, { locale: 'en', store: signedIn() });

		await userEvent.click(await screen.findByRole('button', { name: 'Cancel subscription' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Yes, cancel' }));

		await waitFor(() =>
			expect(api.requests.some((request) => request.method === 'DELETE')).toBe(true),
		);
	});

	it('sends the browser to the checkout url the API returned', async () => {
		api.reply({ status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false });
		const assign = vi.fn();
		vi.stubGlobal('location', { ...window.location, assign });

		renderWithProviders(<BillingPage />, { locale: 'en', store: signedIn() });

		const monthly = await screen.findByRole('button', { name: /monthly/i });
		api.reply({ checkoutUrl: 'https://checkout.example/session' });
		await userEvent.click(monthly);

		await waitFor(() => expect(assign).toHaveBeenCalledWith('https://checkout.example/session'));
		expect(api.lastRequest()?.body).toEqual({ tier: 'pro', cadence: 'monthly' });
	});

	it('lists what the tier includes, straight from the shared map', async () => {
		api.reply({ status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false });
		renderWithProviders(<BillingPage />, { locale: 'en', store: signedIn() });

		expect(await screen.findByText('The plan includes')).toBeInTheDocument();
		expect(screen.getByText('25 users')).toBeInTheDocument();
		expect(screen.getByText('5 devices per user')).toBeInTheDocument();
		expect(screen.getByText('Regions: US, EU')).toBeInTheDocument();
	});

	it('clears the session when the user signs out', async () => {
		api.reply({ status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false });
		const store = signedIn();
		renderWithProviders(<BillingPage />, { locale: 'en', store });

		await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));

		await waitFor(() => expect(store.getState().auth.status).toBe('unauthenticated'));
	});

	it('surfaces a checkout failure without losing the page', async () => {
		api.reply({ status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false });
		renderWithProviders(<BillingPage />, { locale: 'en', store: signedIn() });

		const monthly = await screen.findByRole('button', { name: /monthly/i });
		api.fail('PAYMENT_REQUIRED', 402);
		await userEvent.click(monthly);

		expect(await screen.findByRole('alert')).toHaveTextContent('corr-test');
		expect(screen.getByRole('button', { name: /monthly/i })).toBeInTheDocument();
	});
});
