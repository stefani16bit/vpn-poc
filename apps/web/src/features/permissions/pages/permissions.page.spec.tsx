import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sessionResolved } from '@/app/store/auth-slice.js';
import { makeStore, renderWithProviders, type RecordedRequest } from '@/test-utils.tsx';
import { PermissionsPage } from './permissions.page.tsx';

const GRANTS = {
	roles: [
		{
			role: 'owner',
			defaults: ['billing.manage', 'devices.create', 'permissions.manage'],
			grants: [],
			effective: ['billing.manage', 'devices.create', 'permissions.manage'],
		},
		{ role: 'admin', defaults: ['devices.create'], grants: [], effective: ['devices.create'] },
		{
			role: 'member',
			defaults: ['devices.create'],
			grants: [{ permission: 'devices.create', granted: false }],
			effective: [],
		},
	],
	users: [
		{
			userId: 'user-ana',
			email: 'ana@example.com',
			role: 'member',
			grants: [{ permission: 'devices.create', granted: true }],
		},
	],
};

afterEach(() => {
	vi.unstubAllGlobals();
});

// The page asks for the grants and reads nothing else, so this stub records the
// writes rather than varying the reads — the shared one answers /permissions
// itself, which would swallow exactly the request under test.
function stubRoutes(grants: unknown): RecordedRequest[] {
	const requests: RecordedRequest[] = [];

	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		requests.push({
			url: request.url,
			method: request.method,
			body: await request
				.clone()
				.json()
				.catch(() => null),
			headers: request.headers,
		});

		return new Response(JSON.stringify(grants), {
			status: 200,
			headers: { 'content-type': 'application/json' },
		});
	});

	return requests;
}

function render() {
	const store = makeStore();
	store.dispatch(
		sessionResolved({
			user: {
				id: 'user-owner',
				accountId: 'account-1',
				role: 'owner',
				email: 'owner@example.com',
				emailVerified: true,
				locale: 'en',
				createdAt: '2026-01-01T00:00:00.000Z',
			},
			accessToken: 'access-1',
		}),
	);

	return renderWithProviders(<PermissionsPage />, { locale: 'en', store });
}

describe('PermissionsPage', () => {
	it('shows every role with what it may actually do here', async () => {
		stubRoutes(GRANTS);
		render();

		expect(await screen.findByText('Owner')).toBeInTheDocument();
		expect(screen.getByText('Administrator')).toBeInTheDocument();
		expect(screen.getByText('Member')).toBeInTheDocument();
	});

	it('marks what this company changed, so the default stays legible', async () => {
		stubRoutes(GRANTS);
		render();

		expect(await screen.findByText('Member')).toBeInTheDocument();
		// the member role diverges, and so does the one person who overrides it
		expect(screen.getAllByText('Differs from the default').length).toBe(2);
	});

	it('shows the tenant answer and not the product default', async () => {
		stubRoutes(GRANTS);
		render();

		await screen.findByText('Member');
		const boxes = screen.getAllByRole('checkbox', { name: /generate their own key/i });

		expect(boxes).toHaveLength(4);
		expect(boxes[0]).toBeChecked();
		expect(boxes[2]).not.toBeChecked();
		expect(boxes[3]).toBeChecked();
	});

	it('sends the toggle as a grant against the role it belongs to', async () => {
		const requests = stubRoutes(GRANTS);
		render();

		await screen.findByText('Member');
		const boxes = screen.getAllByRole('checkbox', { name: /generate their own key/i });
		await userEvent.click(boxes[2] as HTMLElement);

		await waitFor(() => expect(requests.some((entry) => entry.method === 'PUT')).toBe(true));
		const put = requests.find((entry) => entry.method === 'PUT');
		expect(put?.url).toContain('permissions/roles/member');
		expect(put?.body).toEqual({ permission: 'devices.create', granted: true });
	});

	it('never lets the owner give away the way back in', async () => {
		stubRoutes(GRANTS);
		render();

		await screen.findByText('Owner');
		const locked = screen.getAllByRole('checkbox', { name: /manage permissions/i });

		expect(locked[0]).toBeDisabled();
		expect(screen.getByText(/never loses this one/i)).toBeInTheDocument();
	});

	it('says so plainly when nobody has an exception', async () => {
		stubRoutes({ ...GRANTS, users: [] });
		render();

		expect(await screen.findByText(/Nobody has an exception/i)).toBeInTheDocument();
	});

	it('lists a person who has one, and sends their toggle against them', async () => {
		const requests = stubRoutes(GRANTS);
		render();

		expect(await screen.findByText('ana@example.com')).toBeInTheDocument();

		const boxes = screen.getAllByRole('checkbox', { name: /generate their own key/i });
		await userEvent.click(boxes[boxes.length - 1] as HTMLElement);

		await waitFor(() => expect(requests.some((entry) => entry.method === 'PUT')).toBe(true));
		expect(requests.find((entry) => entry.method === 'PUT')?.url).toContain(
			'permissions/users/user-ana',
		);
	});

	it('skips a role the server did not describe instead of rendering an empty one', async () => {
		stubRoutes({ roles: GRANTS.roles.filter((entry) => entry.role === 'member') });
		render();

		expect(await screen.findByText('Member')).toBeInTheDocument();
		expect(screen.queryByText('Owner')).not.toBeInTheDocument();
		expect(screen.queryByText('Administrator')).not.toBeInTheDocument();
	});

	it('survives a response that carries no people at all', async () => {
		stubRoutes({ roles: GRANTS.roles });
		render();

		expect(await screen.findByText(/Nobody has an exception/i)).toBeInTheDocument();
	});

	it('leaves the owner out of the per-person list, since it can never be locked out', async () => {
		stubRoutes({
			...GRANTS,
			users: [
				...GRANTS.users,
				{ userId: 'user-owner', email: 'owner@example.com', role: 'owner', grants: [] },
			],
		});
		render();

		expect(await screen.findByText('ana@example.com')).toBeInTheDocument();
		expect(screen.queryByText('owner@example.com')).not.toBeInTheDocument();
	});
});
