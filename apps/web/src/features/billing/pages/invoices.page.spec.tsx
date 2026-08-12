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
import { InvoicesPage } from './invoices.page.tsx';

let api: ApiStub;

function invoice(overrides: Record<string, unknown> = {}) {
	return {
		id: '11111111-1111-1111-1111-111111111111',
		number: 'ACC-0001',
		status: 'paid',
		amountCents: 4900,
		currency: 'brl',
		issuedAt: '2026-08-01T00:00:00.000Z',
		archived: true,
		...overrides,
	};
}

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

function render() {
	return renderWithProviders(<InvoicesPage />, {
		locale: 'en',
		route: '/billing/invoices',
		store: signedIn(),
	});
}

describe('InvoicesPage', () => {
	it('says so when nothing has been charged yet', async () => {
		api.reply({ invoices: [] });
		render();

		expect(await screen.findByText(/no charges yet/i)).toBeInTheDocument();
	});

	it('shows the amount in the currency of the charge, not in cents', async () => {
		api.reply({ invoices: [invoice()] });
		render();

		expect(await screen.findByText(/R\$\s?49\.00/)).toBeInTheDocument();
	});

	it('tells a paid charge from one that failed', async () => {
		api.reply({
			invoices: [
				invoice(),
				invoice({ id: '22222222-2222-2222-2222-222222222222', status: 'failed' }),
			],
		});
		render();

		expect(await screen.findByText('Paid')).toBeInTheDocument();
		expect(screen.getByText('Not paid')).toBeInTheDocument();
	});

	// The archive is a worker job, so the row exists before the document does.
	// Offering a download that would 404 is exactly the dead control DEC-082
	// took out of every other screen.
	it('offers no download while the document is still being archived', async () => {
		api.reply({ invoices: [invoice({ archived: false })] });
		render();

		expect(await screen.findByText(/preparing the pdf/i)).toBeInTheDocument();
		expect(screen.queryByRole('button', { name: /download/i })).not.toBeInTheDocument();
	});

	it('asks our own API for the document, never the provider', async () => {
		api.reply({ invoices: [invoice()] });
		render();

		await userEvent.click(await screen.findByRole('button', { name: /download pdf/i }));

		await waitFor(() => {
			const asked = api.requests.find((request) => request.url.includes('/pdf'));
			expect(asked?.url).toContain('/billing/invoices/11111111-1111-1111-1111-111111111111/pdf');
		});
	});

	it('carries the nav, so the page is not a dead end', async () => {
		api.reply({ invoices: [] });
		render();

		expect(await screen.findByRole('link', { name: 'Your account' })).toBeInTheDocument();
	});
});
