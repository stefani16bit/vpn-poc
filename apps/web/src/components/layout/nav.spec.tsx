import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Permission } from '@vpn/contracts';

import { sessionResolved } from '@/app/store/auth-slice.js';
import { Nav } from '@/components/layout/nav.tsx';
import { makeStore, renderWithProviders, stubApi, type ApiStub } from '@/test-utils.tsx';

let api: ApiStub;

beforeEach(() => {
	api = stubApi();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

function render(granted: Permission[], route = '/') {
	api.grant(...granted);

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

	return renderWithProviders(<Nav />, { locale: 'en', route, store });
}

describe('Nav', () => {
	it('offers the users page to whoever may read it, whatever their role', async () => {
		render(['users.read']);

		expect(await screen.findByRole('link', { name: 'Users' })).toBeInTheDocument();
	});

	it('offers the permissions page only to whoever may edit it', async () => {
		render(['users.read', 'permissions.manage']);

		expect(await screen.findByRole('link', { name: 'Permissions' })).toBeInTheDocument();
	});

	it('hides a page whose link would always 403, which is a dead end', async () => {
		render(['devices.create']);

		expect(await screen.findByRole('link', { name: /devices and keys/i })).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Permissions' })).not.toBeInTheDocument();
	});

	it('leaves out the page it is already on', async () => {
		render(['users.read'], '/keys');

		expect(await screen.findByRole('link', { name: 'Users' })).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: /devices and keys/i })).not.toBeInTheDocument();
	});

	it('offers nothing gated when there is no session yet, and never asks', async () => {
		renderWithProviders(<Nav />, { locale: 'en', route: '/' });

		expect(await screen.findByRole('link', { name: /devices and keys/i })).toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
		expect(api.requests).toEqual([]);
	});
});
