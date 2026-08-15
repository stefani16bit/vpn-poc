import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequireSubscription } from '@/app/access/require-subscription.tsx';
import { sessionResolved } from '@/app/store/auth-slice.js';
import {
	makeStore,
	renderWithProviders,
	stubApi,
	stubSlowApi,
	type ApiStub,
	type TestStore,
} from '@/test-utils.tsx';

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
				role: 'owner',
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

function renderGuard(store: TestStore = signedIn()) {
	return renderWithProviders(
		<Routes>
			<Route
				path="/keys"
				element={
					<RequireSubscription>
						<p>the paid page</p>
					</RequireSubscription>
				}
			/>
			<Route path="/account" element={<p>the account home</p>} />
		</Routes>,
		{ locale: 'en', route: '/keys', store },
	);
}

describe('RequireSubscription', () => {
	it('lets a paying account through', async () => {
		renderGuard();

		expect(await screen.findByText('the paid page')).toBeInTheDocument();
	});

	it('sends an account with no plan back to the page where it can buy one', async () => {
		api.subscribe(null);
		renderGuard();

		expect(await screen.findByText('the account home')).toBeInTheDocument();
		expect(screen.queryByText('the paid page')).not.toBeInTheDocument();
	});

	// Redirecting on the empty first render would bounce a paying account out of
	// its own page before the answer arrived.
	it('waits rather than guessing while the answer is still in flight', async () => {
		const slow = stubSlowApi();
		renderGuard();

		expect(await screen.findByRole('status')).toBeInTheDocument();
		expect(screen.queryByText('the account home')).not.toBeInTheDocument();
		slow.release();
	});

	it('treats a failed read as unsubscribed, so a broken call never opens the door', async () => {
		api.fail('INTERNAL', 500);
		api.subscribe(null);
		renderGuard();

		await waitFor(() => expect(screen.getByText('the account home')).toBeInTheDocument());
	});

	it('never asks before there is a session to ask about', async () => {
		renderGuard(makeStore());

		await waitFor(() => expect(screen.getByText('the account home')).toBeInTheDocument());
		expect(api.requests).toEqual([]);
	});
});
