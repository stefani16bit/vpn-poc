import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { UserRole } from '@vpn/contracts';

import { sessionResolved } from '@/app/store/auth-slice.js';
import { Nav } from '@/components/layout/nav.tsx';
import { makeStore, renderWithProviders, type TestStore } from '@/test-utils.tsx';

function signedIn(role: UserRole): TestStore {
	const store = makeStore();
	store.dispatch(
		sessionResolved({
			user: {
				id: 'user-1',
				accountId: 'account-1',
				role,
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

function render(role: UserRole, route: string) {
	return renderWithProviders(<Nav />, { locale: 'en', route, store: signedIn(role) });
}

describe('Nav', () => {
	it('offers the users page to an admin', () => {
		render('admin', '/');

		expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
	});

	it('offers it to the owner too, because owner outranks admin', () => {
		render('owner', '/');

		expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
	});

	it('hides it from a member, because a link that always 403s is a dead end', () => {
		render('member', '/');

		expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
		expect(screen.getByRole('link', { name: /devices and keys/i })).toBeInTheDocument();
	});

	it('leaves out the page it is already on', () => {
		render('admin', '/keys');

		expect(screen.queryByRole('link', { name: /devices and keys/i })).not.toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
	});

	it('offers nothing role-gated when there is no session yet', () => {
		renderWithProviders(<Nav />, { locale: 'en', route: '/' });

		expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
	});
});
