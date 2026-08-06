import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubApi, type ApiStub } from '@/test-utils.tsx';
import { VerifyEmailPage } from './verify-email.page.tsx';

const TOKEN = 'x'.repeat(43);

let api: ApiStub;

beforeEach(() => {
	api = stubApi();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('VerifyEmailPage', () => {
	it('redeems the token from the link on mount', async () => {
		api.reply({ acknowledged: true });
		renderWithProviders(<VerifyEmailPage />, {
			locale: 'en',
			route: `/verify-email?token=${TOKEN}`,
		});

		await waitFor(() => expect(api.lastRequest()?.url).toContain('auth/verify-email'));
		expect(api.lastRequest()?.body).toEqual({ token: TOKEN });
	});

	it('redeems it exactly once, even though StrictMode runs effects twice', async () => {
		api.reply({ acknowledged: true });
		renderWithProviders(<VerifyEmailPage />, {
			locale: 'en',
			route: `/verify-email?token=${TOKEN}`,
		});

		await waitFor(() => expect(api.requests.length).toBeGreaterThan(0));
		expect(api.requests).toHaveLength(1);
	});

	it('confirms success and offers the way to sign in', async () => {
		api.reply({ acknowledged: true });
		renderWithProviders(<VerifyEmailPage />, {
			locale: 'en',
			route: `/verify-email?token=${TOKEN}`,
		});

		expect(await screen.findByText('E-mail confirmed')).toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
	});

	it('explains a spent token and offers a resend', async () => {
		api.fail('TOKEN_INVALID', 400);
		renderWithProviders(<VerifyEmailPage />, {
			locale: 'en',
			route: `/verify-email?token=${TOKEN}`,
		});

		const alert = await screen.findByRole('alert');
		expect(alert).toHaveTextContent('This link is not valid or has already been used.');
		expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
	});

	it('shows the pending screen and a resend form when there is no token', () => {
		renderWithProviders(<VerifyEmailPage />, { locale: 'en', route: '/verify-email' });

		expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
		expect(api.requests).toHaveLength(0);
	});
});

describe('ResendVerificationForm', () => {
	it('posts the address it was given', async () => {
		api.reply({ acknowledged: true }, 202);
		renderWithProviders(<VerifyEmailPage />, { locale: 'en', route: '/verify-email' });

		await userEvent.type(screen.getByLabelText('E-mail'), 'ada@example.com');
		await userEvent.click(screen.getByRole('button', { name: 'Resend link' }));

		await waitFor(() => expect(api.lastRequest()?.url).toContain('auth/resend-verification'));
		expect(api.lastRequest()?.body).toEqual({ email: 'ada@example.com' });
	});

	it('starts a cooldown that disables the button', async () => {
		api.reply({ acknowledged: true }, 202);
		renderWithProviders(<VerifyEmailPage />, { locale: 'en', route: '/verify-email' });

		await userEvent.type(screen.getByLabelText('E-mail'), 'ada@example.com');
		await userEvent.click(screen.getByRole('button', { name: 'Resend link' }));

		await waitFor(() => expect(screen.getByRole('button', { name: /60/ })).toBeDisabled());
	});

	it('does not send a second time while the cooldown runs', async () => {
		api.reply({ acknowledged: true }, 202);
		renderWithProviders(<VerifyEmailPage />, { locale: 'en', route: '/verify-email' });

		await userEvent.type(screen.getByLabelText('E-mail'), 'ada@example.com');
		await userEvent.click(screen.getByRole('button', { name: 'Resend link' }));
		await waitFor(() => expect(api.requests.length).toBe(1));

		await userEvent.click(screen.getByRole('button', { name: /60/ }), { pointerEventsCheck: 0 });
		expect(api.requests).toHaveLength(1);
	});

	it('announces the countdown politely rather than silently', async () => {
		api.reply({ acknowledged: true }, 202);
		const { container } = renderWithProviders(<VerifyEmailPage />, {
			locale: 'en',
			route: '/verify-email',
		});

		await userEvent.type(screen.getByLabelText('E-mail'), 'ada@example.com');
		await userEvent.click(screen.getByRole('button', { name: 'Resend link' }));

		await waitFor(() =>
			expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain('60'),
		);
	});
});
