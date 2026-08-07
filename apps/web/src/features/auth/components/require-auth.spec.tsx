import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { sessionCleared, sessionResolved, sessionUnknown } from '@/app/store/auth-slice.js';
import { makeStore, renderWithProviders, type TestStore } from '@/test-utils.tsx';
import { RequireAuth } from './require-auth.tsx';

function storeWith(emailVerified: boolean): TestStore {
	const store = makeStore();
	store.dispatch(
		sessionResolved({
			user: {
				id: 'acc-1',
				accountId: 'account-1',
				role: 'owner' as const,
				email: 'ada@example.com',
				emailVerified,
				locale: 'en',
				createdAt: '2026-01-01T00:00:00.000Z',
			},
			accessToken: 'access-1',
		}),
	);
	return store;
}

function renderGuard(store: TestStore, allowUnverified = false) {
	return renderWithProviders(
		<Routes>
			<Route
				path="/"
				element={
					<RequireAuth allowUnverified={allowUnverified}>
						<p>the private page</p>
					</RequireAuth>
				}
			/>
			<Route path="/login" element={<p>the login page</p>} />
			<Route path="/verify-email" element={<p>the verify page</p>} />
		</Routes>,
		{ locale: 'en', store },
	);
}

describe('RequireAuth', () => {
	it('waits rather than flashing the login page while the session is unknown', () => {
		const store = makeStore();
		store.dispatch(sessionUnknown());

		renderGuard(store);

		expect(screen.getByRole('status')).toBeInTheDocument();
		expect(screen.queryByText('the login page')).not.toBeInTheDocument();
	});

	it('sends an unauthenticated visitor to the login page', () => {
		const store = makeStore();
		store.dispatch(sessionCleared());

		renderGuard(store);

		expect(screen.getByText('the login page')).toBeInTheDocument();
	});

	it('lets a verified account through', () => {
		renderGuard(storeWith(true));
		expect(screen.getByText('the private page')).toBeInTheDocument();
	});

	it('diverts an unverified account to the screen that fixes that', () => {
		renderGuard(storeWith(false));
		expect(screen.getByText('the verify page')).toBeInTheDocument();
	});

	it('lets an unverified account through where the route allows it', () => {
		renderGuard(storeWith(false), true);
		expect(screen.getByText('the private page')).toBeInTheDocument();
	});
});
