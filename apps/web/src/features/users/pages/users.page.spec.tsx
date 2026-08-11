import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionResolved } from '@/app/store/auth-slice.js';
import {
	makeStore,
	renderWithProviders,
	stubApi,
	type ApiStub,
	type TestStore,
} from '@/test-utils.tsx';
import { UsersPage } from './users.page.tsx';

let api: ApiStub;

const OWNER_ID = 'user-owner';

function accountUser(overrides: Record<string, unknown> = {}) {
	return {
		id: 'user-member',
		email: 'member@example.com',
		role: 'member',
		emailVerified: true,
		locale: 'en',
		liveDeviceCount: 0,
		createdAt: '2026-08-09T00:00:00.000Z',
		...overrides,
	};
}

beforeEach(() => {
	api = stubApi();
});

function signedIn(role: 'owner' | 'admin' | 'member' = 'owner'): TestStore {
	const store = makeStore();
	store.dispatch(
		sessionResolved({
			user: {
				id: OWNER_ID,
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

function render(role: 'owner' | 'admin' | 'member' = 'owner') {
	return renderWithProviders(<UsersPage />, { locale: 'en', store: signedIn(role) });
}

describe('UsersPage', () => {
	it('says so when nobody else has access yet', async () => {
		api.reply({ users: [] });
		render();

		expect(await screen.findByText(/no users besides you yet/i)).toBeInTheDocument();
	});

	it('lists the owner too, marked, because hiding them would make the screen lie', async () => {
		api.reply({
			users: [
				accountUser({ id: OWNER_ID, email: 'ada@example.com', role: 'owner' }),
				accountUser(),
			],
		});
		render();

		expect(await screen.findByText('ada@example.com')).toBeInTheDocument();
		expect(screen.getByText('Owner')).toBeInTheDocument();
		expect(screen.getByText(/— You/)).toBeInTheDocument();
	});

	it('sends only the e-mail and the role, and never a password', async () => {
		api.reply({ users: [] });
		render();

		await userEvent.type(await screen.findByLabelText('E-mail'), 'new@example.com');
		api.reply(
			{ user: accountUser({ email: 'new@example.com' }), temporaryPassword: 'sekrit' },
			201,
		);
		await userEvent.click(screen.getByRole('button', { name: /create user/i }));

		await waitFor(() => {
			const posted = api.requests.find((request) => request.method === 'POST');
			expect(posted?.body).toEqual({ email: 'new@example.com', role: 'member' });
		});
	});

	it('shows the temporary password once, and lets it be copied', async () => {
		const writeText = vi.fn(() => Promise.resolve());
		vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });

		api.reply({ users: [] });
		render();

		await userEvent.type(await screen.findByLabelText('E-mail'), 'new@example.com');
		api.reply(
			{ user: accountUser({ email: 'new@example.com' }), temporaryPassword: 'sekrit' },
			201,
		);
		await userEvent.click(screen.getByRole('button', { name: /create user/i }));

		const dialog = await screen.findByRole('alertdialog');
		expect(dialog).toHaveTextContent('sekrit');

		await userEvent.click(screen.getByRole('button', { name: /copy password/i }));
		expect(writeText).toHaveBeenCalledWith('sekrit');

		await userEvent.click(screen.getByRole('button', { name: /i have copied it/i }));
		await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
		expect(screen.queryByText('sekrit')).not.toBeInTheDocument();
	});

	it('refuses to send an invalid address, and says so on the field', async () => {
		api.reply({ users: [] });
		render();

		await userEvent.type(await screen.findByLabelText('E-mail'), 'not-an-email');
		await userEvent.click(screen.getByRole('button', { name: /create user/i }));

		expect(await screen.findByRole('alert')).toBeInTheDocument();
		expect(api.requests.some((request) => request.method === 'POST')).toBe(false);
	});

	it('offers neither action against the owner nor against yourself', async () => {
		api.reply({
			users: [accountUser({ id: OWNER_ID, email: 'ada@example.com', role: 'owner' })],
		});
		render();

		await screen.findByText('ada@example.com');
		expect(screen.queryByRole('button', { name: /remove/i })).not.toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /change role/i })).not.toBeInTheDocument();
	});

	it('promotes a member and reports that their sessions ended', async () => {
		api.reply({ users: [accountUser()] });
		render();

		await screen.findByText('member@example.com');
		api.reply({ user: accountUser({ role: 'admin' }) });
		await userEvent.click(screen.getByRole('button', { name: /change role/i }));

		await waitFor(() => {
			const patched = api.requests.find((request) => request.method === 'PATCH');
			expect(patched?.body).toEqual({ role: 'admin' });
		});
		expect(await screen.findByText(/sessions were ended/i)).toBeInTheDocument();
	});

	it('asks before removing, and only then deletes', async () => {
		api.reply({ users: [accountUser()] });
		render();

		await screen.findByText('member@example.com');
		await userEvent.click(screen.getByRole('button', { name: /^remove$/i }));

		expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
		expect(api.requests.some((request) => request.method === 'DELETE')).toBe(false);

		api.reply(null, 204);
		await userEvent.click(screen.getByRole('button', { name: /yes, remove/i }));

		await waitFor(() =>
			expect(api.requests.some((request) => request.method === 'DELETE')).toBe(true),
		);
	});

	it('shows the live device count, which is what explains a refused removal', async () => {
		api.reply({ users: [accountUser({ liveDeviceCount: 3 })] });
		render();

		expect(await screen.findByText('Active devices: 3')).toBeInTheDocument();
	});

	it('carries the nav, so the page is not a dead end', async () => {
		api.reply({ users: [] });
		render();

		expect(await screen.findByRole('link', { name: /devices and keys/i })).toBeInTheDocument();
	});
});
