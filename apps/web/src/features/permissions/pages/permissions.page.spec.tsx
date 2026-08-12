import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { sessionResolved } from '@/app/store/auth-slice.js';
import { makeStore, renderWithProviders, type RecordedRequest } from '@/test-utils.tsx';
import { PermissionsPage } from './permissions.page.tsx';

// The server never sends the owner: it holds every permission by construction,
// so there is nothing on that row a screen could offer to change.
const GRANTS = {
	roles: [
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

		expect(await screen.findByText('Administrator')).toBeInTheDocument();
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

		expect(boxes).toHaveLength(3);
		expect(boxes[0]).toBeChecked();
		expect(boxes[1]).not.toBeChecked();
		expect(boxes[2]).toBeChecked();
	});

	it('sends the toggle as a grant against the role it belongs to', async () => {
		const requests = stubRoutes(GRANTS);
		render();

		await screen.findByText('Member');
		const boxes = screen.getAllByRole('checkbox', { name: /generate their own key/i });
		await userEvent.click(boxes[1] as HTMLElement);

		await waitFor(() => expect(requests.some((entry) => entry.method === 'PUT')).toBe(true));
		const put = requests.find((entry) => entry.method === 'PUT');
		expect(put?.url).toContain('permissions/roles/member');
		expect(put?.body).toEqual({ permission: 'devices.create', granted: true });
	});

	it('never draws the owner, because none of it could be changed anyway', async () => {
		stubRoutes(GRANTS);
		render();

		expect(await screen.findByText('Member')).toBeInTheDocument();
		expect(screen.queryByText('Owner')).not.toBeInTheDocument();
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

	it('draws exactly the roles the server sent, and invents none', async () => {
		stubRoutes({ roles: GRANTS.roles.filter((entry) => entry.role === 'member') });
		render();

		expect(await screen.findByText('Member')).toBeInTheDocument();
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
