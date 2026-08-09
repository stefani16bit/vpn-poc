import { act, screen } from '@testing-library/react';
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
import { CheckoutSuccessPage } from './checkout-success.page.tsx';

const ACTIVE = { status: 'active', currentPeriodEnd: null, cancelAtPeriodEnd: false };
const NONE = { status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false };

let api: ApiStub;

beforeEach(() => {
	api = stubApi();
});

afterEach(() => {
	vi.useRealTimers();
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

function render(route = '/billing/success') {
	return renderWithProviders(<CheckoutSuccessPage />, { locale: 'en', route, store: signedIn() });
}

async function advance(ms: number) {
	await act(async () => {
		await vi.advanceTimersByTimeAsync(ms);
	});
}

describe('CheckoutSuccessPage', () => {
	it('acknowledges the payment while the subscription is not active yet', async () => {
		api.reply(NONE);
		render();

		expect(await screen.findByText('Payment received')).toBeInTheDocument();
		expect(screen.getByText('We are activating your subscription.')).toBeInTheDocument();
		expect(await screen.findByRole('status')).toBeInTheDocument();
	});

	it('shows the subscription and the tier once the webhook has landed', async () => {
		api.reply(ACTIVE);
		render();

		expect(await screen.findByText('Subscription active')).toBeInTheDocument();
		expect(screen.getByText('Your account is on the Pro plan.')).toBeInTheDocument();
		expect(screen.getByText('Active')).toBeInTheDocument();
		expect(screen.getByText('25 users')).toBeInTheDocument();
	});

	it('resolves when the webhook lands while the page is still polling', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		api.reply(NONE);
		render();

		expect(await screen.findByText('Payment received')).toBeInTheDocument();

		api.reply(ACTIVE);
		await advance(2000);

		expect(await screen.findByText('Subscription active')).toBeInTheDocument();
	});

	it('counts a trial as activated, because it grants the same tier', async () => {
		api.reply({ status: 'trialing', currentPeriodEnd: null, cancelAtPeriodEnd: false });
		render();

		expect(await screen.findByText('Subscription active')).toBeInTheDocument();
	});

	it('stops waiting after a bounded time and says it is being processed, not failed', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		api.reply(NONE);
		render();

		expect(await screen.findByText('Payment received')).toBeInTheDocument();
		await advance(15_000);

		expect(
			await screen.findByText(
				'Activation is still being processed. This usually takes a few seconds.',
			),
		).toBeInTheDocument();
		expect(screen.getByText('Payment received')).toBeInTheDocument();
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('stops polling once it has given up waiting', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		api.reply(NONE);
		render();

		await advance(15_000);
		expect(await screen.findByRole('button', { name: 'Check again' })).toBeInTheDocument();

		const beforeIdling = api.requests.length;
		await advance(30_000);

		expect(api.requests).toHaveLength(beforeIdling);
	});

	it('reads again when asked, and resolves if the webhook has landed since', async () => {
		vi.useFakeTimers({ shouldAdvanceTime: true });
		api.reply(NONE);
		render();

		await advance(15_000);
		const checkAgain = await screen.findByRole('button', { name: 'Check again' });

		api.reply(ACTIVE);
		await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(checkAgain);

		expect(await screen.findByText('Subscription active')).toBeInTheDocument();
	});

	it('surfaces a failed read without ever claiming the payment failed', async () => {
		api.fail('INTERNAL', 500);
		render();

		expect(await screen.findByRole('alert')).toHaveTextContent('corr-test');
		expect(screen.getByText('Payment received')).toBeInTheDocument();
		expect(
			screen.getByText('Activation is still being processed. This usually takes a few seconds.'),
		).toBeInTheDocument();
	});

	it('ignores the query string the offline driver appends', async () => {
		api.reply(ACTIVE);
		render('/billing/success?checkout=cs_1&price=price_monthly');

		expect(await screen.findByText('Subscription active')).toBeInTheDocument();
	});
});
