import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Permission } from '@vpn/contracts';

import { RequirePermission } from '@/app/access/require-permission.tsx';
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
				role: 'member',
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

function renderGuard(anyOf: readonly Permission[], store: TestStore = signedIn()) {
	return renderWithProviders(
		<Routes>
			<Route
				path="/users"
				element={
					<RequirePermission anyOf={anyOf}>
						<p>the guarded page</p>
					</RequirePermission>
				}
			/>
			<Route path="/" element={<p>the account home</p>} />
		</Routes>,
		{ locale: 'en', route: '/users', store },
	);
}

describe('RequirePermission', () => {
	it('lets through whoever holds the permission', async () => {
		api.grant('users.read');
		renderGuard(['users.read']);

		expect(await screen.findByText('the guarded page')).toBeInTheDocument();
	});

	it('sends home whoever does not, instead of letting the page 403 field by field', async () => {
		api.grant('devices.create');
		renderGuard(['users.read']);

		expect(await screen.findByText('the account home')).toBeInTheDocument();
		expect(screen.queryByText('the guarded page')).not.toBeInTheDocument();
	});

	it('opens on any one of them, because a screen can be worth opening for more than one reason', async () => {
		api.grant('devices.readAll');
		renderGuard(['devices.create', 'devices.readAll']);

		expect(await screen.findByText('the guarded page')).toBeInTheDocument();
	});

	it('needs at least one of them and not merely a session', async () => {
		api.grant();
		renderGuard(['devices.create', 'devices.readAll']);

		await waitFor(() => expect(screen.getByText('the account home')).toBeInTheDocument());
	});

	// Redirecting on the empty first render would bounce somebody out of a page
	// they are allowed to open, before the answer arrived. The same defect the
	// subscription guard avoids by having three states.
	it('waits rather than guessing while the answer is still in flight', async () => {
		const slow = stubSlowApi();
		renderGuard(['users.read']);

		expect(await screen.findByRole('status')).toBeInTheDocument();
		expect(screen.queryByText('the account home')).not.toBeInTheDocument();
		slow.release();
	});

	it('treats a failed read as denied, so a broken call never opens the door', async () => {
		api.breakGrants();
		renderGuard(['users.read']);

		await waitFor(() => expect(screen.getByText('the account home')).toBeInTheDocument());
	});

	// A page that stubs one body for every route hands this hook a shape without
	// permissions at all. Exploding there would take down the nav of any screen
	// under test; staying at "unknown" would hang the guard forever.
	it('denies rather than throws when the answer carries no permissions', async () => {
		vi.stubGlobal(
			'fetch',
			() =>
				new Response(JSON.stringify({ roles: [], users: [] }), {
					status: 200,
					headers: { 'content-type': 'application/json' },
				}),
		);
		renderGuard(['users.read']);

		await waitFor(() => expect(screen.getByText('the account home')).toBeInTheDocument());
	});

	it('never asks before there is a session to ask about', async () => {
		renderGuard(['users.read'], makeStore());

		await waitFor(() => expect(screen.getByText('the account home')).toBeInTheDocument());
		expect(api.requests).toEqual([]);
	});
});
