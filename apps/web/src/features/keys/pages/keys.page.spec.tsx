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
import { KeysPage } from './keys.page.tsx';

let api: ApiStub;
let downloads: { name: string; contents: string }[];

vi.mock('@/lib/download.js', () => ({
	downloadTextFile: (name: string, contents: string) => {
		downloads.push({ name, contents });
	},
}));

const NODE = {
	publicKey: 'rKCjjZR5cgoZSG0BE1Cjs5wHcOAOYU5Vweb/Gj0rPWg=',
	endpoint: '127.0.0.1:21820',
	allowedIps: ['10.13.13.0/24'],
};

function device(overrides: Record<string, unknown> = {}) {
	return {
		id: 'dev-1',
		name: 'laptop',
		publicKey: 'hAcCPVXqcJRVvi/JIn1jjnpUAxbfEbAJPBUlkAcO8k4=',
		tunnelAddress: '10.13.13.4/32',
		provisionedAt: null,
		createdAt: '2026-08-09T00:00:00.000Z',
		...overrides,
	};
}

beforeEach(() => {
	api = stubApi();
	downloads = [];
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

function render() {
	return renderWithProviders(<KeysPage />, { locale: 'en', store: signedIn() });
}

describe('KeysPage', () => {
	it('says the private key never leaves the browser, because that is the whole design', async () => {
		api.reply({ devices: [], node: NODE });
		render();

		expect(await screen.findByText(/never sent to us/i)).toBeInTheDocument();
	});

	it('offers nothing to download until a device exists', async () => {
		api.reply({ devices: [], node: NODE });
		render();

		expect(await screen.findByText(/no devices yet/i)).toBeInTheDocument();
	});

	it('sends only the public half of the pair', async () => {
		api.reply({ devices: [], node: NODE });
		render();

		await userEvent.type(await screen.findByLabelText('Device name'), 'work laptop');
		api.reply({ device: device(), node: NODE }, 201);
		await userEvent.click(screen.getByRole('button', { name: /generate key/i }));

		await waitFor(() => expect(downloads).toHaveLength(1));

		const posted = api.requests.find((request) => request.method === 'POST');
		expect(Object.keys(posted?.body as object)).toEqual(['name', 'publicKey']);
	});

	it('never lets the private key reach the network, in any request', async () => {
		api.reply({ devices: [], node: NODE });
		render();

		await userEvent.type(await screen.findByLabelText('Device name'), 'laptop');
		api.reply({ device: device(), node: NODE }, 201);
		await userEvent.click(screen.getByRole('button', { name: /generate key/i }));

		await waitFor(() => expect(downloads).toHaveLength(1));

		const privateKey = /PrivateKey = (.+)/.exec(downloads[0]?.contents ?? '')?.[1];
		expect(privateKey).toBeTruthy();

		const sent = JSON.stringify(api.requests);
		expect(sent).not.toContain(privateKey);
	});

	it('downloads a config the WireGuard client can import', async () => {
		api.reply({ devices: [], node: NODE });
		render();

		await userEvent.type(await screen.findByLabelText('Device name'), 'work laptop');
		api.reply({ device: device({ name: 'work laptop' }), node: NODE }, 201);
		await userEvent.click(screen.getByRole('button', { name: /generate key/i }));

		await waitFor(() => expect(downloads).toHaveLength(1));

		expect(downloads[0]?.name).toBe('work-laptop.conf');
		expect(downloads[0]?.contents).toContain('[Interface]');
		expect(downloads[0]?.contents).toContain('Address = 10.13.13.4/32');
		expect(downloads[0]?.contents).toContain(`PublicKey = ${NODE.publicKey}`);
		expect(downloads[0]?.contents).toContain('AllowedIPs = 10.13.13.0/24');
	});

	it('warns that the file cannot be downloaded again, which is what DEC-045 requires', async () => {
		api.reply({ devices: [], node: NODE });
		render();

		expect(await screen.findByText(/can only be downloaded now/i)).toBeInTheDocument();
	});

	it('says a device is still being opened up rather than pretending it works', async () => {
		api.reply({ devices: [device()], node: NODE });
		render();

		expect(await screen.findByText(/opening access on the server/i)).toBeInTheDocument();
	});

	it('says a provisioned device is active', async () => {
		api.reply({ devices: [device({ provisionedAt: '2026-08-09T00:00:05.000Z' })], node: NODE });
		render();

		expect(await screen.findByText('Active')).toBeInTheDocument();
	});

	it('does not revoke anything until the confirmation is accepted', async () => {
		api.reply({ devices: [device()], node: NODE });
		render();

		await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
		await screen.findByRole('alertdialog');
		await userEvent.click(screen.getByRole('button', { name: 'Keep device' }));

		expect(api.requests.every((request) => request.method !== 'DELETE')).toBe(true);
	});

	it('revokes once the confirmation is accepted', async () => {
		api.reply({ devices: [device()], node: NODE });
		render();

		await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Yes, revoke' }));

		await waitFor(() =>
			expect(api.requests.some((request) => request.method === 'DELETE')).toBe(true),
		);
	});

	it('shows the 402 as a plan problem rather than a generic failure', async () => {
		api.fail('PAYMENT_REQUIRED', 402);
		render();

		expect(await screen.findByRole('alert')).toHaveTextContent(/active subscription is required/i);
	});

	it('tells the user when the browser cannot generate a key at all', async () => {
		api.reply({ devices: [], node: NODE });
		const real = globalThis.crypto;
		vi.stubGlobal('crypto', {
			getRandomValues: () => {
				throw new Error('no randomness');
			},
			subtle: {
				...real.subtle,
				generateKey: () => Promise.reject(new DOMException('nope', 'NotSupportedError')),
			},
		});

		render();
		await userEvent.type(await screen.findByLabelText('Device name'), 'laptop');
		await userEvent.click(screen.getByRole('button', { name: /generate key/i }));

		expect(await screen.findByText(/cannot generate X25519 keys/i)).toBeInTheDocument();
		expect(api.requests.every((request) => request.method !== 'POST')).toBe(true);
	});
});
