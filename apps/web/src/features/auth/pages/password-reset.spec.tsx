import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubApi, type ApiStub } from '@/test-utils.tsx';
import { ForgotPasswordPage } from './forgot-password.page.tsx';
import { ResetPasswordPage } from './reset-password.page.tsx';

// A real token is 32 random bytes base64url; the schema rejects anything short
// enough to brute-force.
const TOKEN = 'x'.repeat(43);

let api: ApiStub;

beforeEach(() => {
	api = stubApi();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('ForgotPasswordPage', () => {
	it('refuses an invalid address without calling the API', async () => {
		renderWithProviders(<ForgotPasswordPage />, { locale: 'en' });

		await userEvent.type(screen.getByLabelText('E-mail'), 'not-an-email');
		await userEvent.click(screen.getByRole('button', { name: /send/i }));

		await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
		expect(api.requests).toHaveLength(0);
	});

	it('posts the address to the forgot-password route', async () => {
		api.reply({ acknowledged: true }, 202);
		renderWithProviders(<ForgotPasswordPage />, { locale: 'en' });

		await userEvent.type(screen.getByLabelText('E-mail'), 'ada@example.com');
		await userEvent.click(screen.getByRole('button', { name: /send/i }));

		await waitFor(() => expect(api.lastRequest()?.url).toContain('auth/forgot-password'));
		expect(api.lastRequest()?.body).toEqual({ email: 'ada@example.com' });
	});

	it('confirms without revealing whether the address had an account', async () => {
		api.reply({ acknowledged: true }, 202);
		renderWithProviders(<ForgotPasswordPage />, { locale: 'en' });

		await userEvent.type(screen.getByLabelText('E-mail'), 'nobody@example.com');
		await userEvent.click(screen.getByRole('button', { name: /send/i }));

		await waitFor(() => expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument());
		expect(screen.queryByText(/nobody@example.com/)).not.toBeInTheDocument();
	});

	it('moves focus to the confirmation heading', async () => {
		api.reply({ acknowledged: true }, 202);
		renderWithProviders(<ForgotPasswordPage />, { locale: 'en' });

		await userEvent.type(screen.getByLabelText('E-mail'), 'ada@example.com');
		await userEvent.click(screen.getByRole('button', { name: /send/i }));

		await waitFor(() => expect(screen.getByText('Check your e-mail')).toHaveFocus());
	});
});

describe('ResetPasswordPage', () => {
	it('refuses to show a form when the link carries no token', () => {
		renderWithProviders(<ResetPasswordPage />, { locale: 'en', route: '/reset-password' });

		expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
		expect(screen.getByRole('link', { name: /request/i })).toHaveAttribute(
			'href',
			'/forgot-password',
		);
	});

	it('focuses the heading of the invalid-link screen', () => {
		renderWithProviders(<ResetPasswordPage />, { locale: 'en', route: '/reset-password' });
		expect(screen.getByText('Invalid link')).toHaveFocus();
	});

	it('refuses to show a form when the token is present but malformed', () => {
		renderWithProviders(<ResetPasswordPage />, {
			locale: 'en',
			route: '/reset-password?token=truncated',
		});

		expect(screen.queryByLabelText('New password')).not.toBeInTheDocument();
		expect(screen.getByText('Invalid link')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /request/i })).toHaveAttribute(
			'href',
			'/forgot-password',
		);
	});

	it('carries the token from the query string into the request', async () => {
		api.reply({ acknowledged: true });
		renderWithProviders(<ResetPasswordPage />, {
			locale: 'en',
			route: `/reset-password?token=${TOKEN}`,
		});

		await userEvent.type(screen.getByLabelText('New password'), 'a-long-enough-password');
		await userEvent.click(screen.getByRole('button', { name: /change|reset|save/i }));

		await waitFor(() => expect(api.lastRequest()?.url).toContain('auth/reset-password'));
		expect(api.lastRequest()?.body).toMatchObject({ token: TOKEN });
	});

	it('explains an expired link instead of pretending it worked', async () => {
		api.fail('TOKEN_EXPIRED', 410);
		renderWithProviders(<ResetPasswordPage />, {
			locale: 'en',
			route: `/reset-password?token=${TOKEN}`,
		});

		await userEvent.type(screen.getByLabelText('New password'), 'a-long-enough-password');
		await userEvent.click(screen.getByRole('button', { name: /change|reset|save/i }));

		const alert = await screen.findByRole('alert');
		expect(alert).toHaveTextContent('This link has expired. Request a new one.');
		expect(screen.getByLabelText('New password')).toBeInTheDocument();
	});
});
