import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { makeStore, renderWithProviders } from '@/test-utils.tsx';
import { LoginPage } from './login.page.tsx';

interface Handler {
	readonly status: number;
	readonly body: unknown;
}

let next: Handler = { status: 200, body: {} };
let lastRequest: { url: string; body: unknown } | null = null;

beforeEach(() => {
	next = { status: 200, body: {} };
	lastRequest = null;

	vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = input instanceof Request ? input : new Request(String(input), init);
		lastRequest = {
			url: request.url,
			body: await request
				.clone()
				.json()
				.catch(() => null),
		};
		return new Response(JSON.stringify(next.body), {
			status: next.status,
			headers: { 'content-type': 'application/json' },
		});
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
});

const SESSION = {
	user: {
		id: 'acc-1',
		email: 'ada@example.com',
		emailVerified: true,
		locale: 'pt-BR',
		createdAt: '2026-01-01T00:00:00.000Z',
	},
	accessToken: 'access-1',
	expiresIn: 900,
};

describe('LoginPage', () => {
	it('renders an email and a password field', () => {
		renderWithProviders(<LoginPage />, { locale: 'en' });

		expect(screen.getByLabelText('E-mail')).toHaveAttribute('type', 'email');
		expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
	});

	it('asks the browser for the right autofill', () => {
		renderWithProviders(<LoginPage />, { locale: 'en' });

		expect(screen.getByLabelText('E-mail')).toHaveAttribute('autocomplete', 'email');
		expect(screen.getByLabelText('Password')).toHaveAttribute(
			'autocomplete',
			'current-password',
		);
	});

	it('shows the field error from the shared schema rather than submitting', async () => {
		renderWithProviders(<LoginPage />, { locale: 'en' });

		await userEvent.type(screen.getByLabelText('E-mail'), 'not-an-email');
		await userEvent.type(screen.getByLabelText('Password'), 'x');
		await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

		await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
		expect(lastRequest).toBeNull();
	});

	it('marks the invalid control with aria-invalid', async () => {
		renderWithProviders(<LoginPage />, { locale: 'en' });

		await userEvent.type(screen.getByLabelText('E-mail'), 'not-an-email');
		await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

		await waitFor(() =>
			expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-invalid', 'true'),
		);
	});

	it('posts the credentials and resolves the session', async () => {
		next = { status: 200, body: SESSION };
		const store = makeStore();

		renderWithProviders(<LoginPage />, { locale: 'en', store });

		await userEvent.type(screen.getByLabelText('E-mail'), 'ada@example.com');
		await userEvent.type(screen.getByLabelText('Password'), 'a-long-enough-password');
		await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

		await waitFor(() => expect(store.getState().auth.status).toBe('authenticated'));
		expect(lastRequest?.url).toContain('auth/login');
		expect(store.getState().auth.accessToken).toBe('access-1');
	});

	it('surfaces a rejected credential as a translated alert', async () => {
		next = {
			status: 401,
			body: { code: 'INVALID_CREDENTIALS', message: 'nope', correlationId: 'corr-1' },
		};

		renderWithProviders(<LoginPage />, { locale: 'en' });

		await userEvent.type(screen.getByLabelText('E-mail'), 'ada@example.com');
		await userEvent.type(screen.getByLabelText('Password'), 'a-long-enough-password');
		await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

		const alert = await screen.findByRole('alert');
		expect(alert).toHaveTextContent('E-mail or password is incorrect.');
		expect(alert).toHaveTextContent('corr-1');
		expect(alert).not.toHaveTextContent('nope');
	});

	it('sends an unverified account to the screen that fixes that', async () => {
		next = {
			status: 403,
			body: { code: 'EMAIL_NOT_VERIFIED', message: 'confirm', correlationId: 'corr-2' },
		};

		renderWithProviders(<LoginPage />, { locale: 'en' });

		await userEvent.type(screen.getByLabelText('E-mail'), 'ada@example.com');
		await userEvent.type(screen.getByLabelText('Password'), 'a-long-enough-password');
		await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

		await waitFor(() => expect(screen.queryByLabelText('Password')).not.toBeInTheDocument());
	});

	it('offers the way out to signup and to password recovery', () => {
		renderWithProviders(<LoginPage />, { locale: 'en' });

		expect(screen.getByRole('link', { name: /forgot/i })).toHaveAttribute(
			'href',
			'/forgot-password',
		);
		expect(screen.getByRole('link', { name: /account/i })).toHaveAttribute('href', '/signup');
	});
});
