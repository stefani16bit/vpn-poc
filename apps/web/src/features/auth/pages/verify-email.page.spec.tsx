import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionCleared } from '@/app/store/auth-slice.js';
import {
	makeStore,
	renderWithProviders,
	stubApi,
	stubSlowApi,
	type ApiStub,
} from '@/test-utils.tsx';
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

	it('survives a remount: the request is neither aborted nor sent twice', async () => {
		const store = makeStore();
		const slow = stubSlowApi();

		const first = renderWithProviders(<VerifyEmailPage />, {
			locale: 'en',
			route: `/verify-email?token=${TOKEN}`,
			store,
		});

		await waitFor(() => expect(slow.requests).toHaveLength(1));
		first.unmount();

		renderWithProviders(<VerifyEmailPage />, {
			locale: 'en',
			route: `/verify-email?token=${TOKEN}`,
			store,
		});

		slow.release();

		expect(await screen.findByText('E-mail confirmed')).toBeInTheDocument();
		expect(slow.requests).toHaveLength(1);
		expect(slow.aborted).toEqual([]);
	});

	it('survives the boot refresh finding no session while it is in flight', async () => {
		const store = makeStore();
		const slow = stubSlowApi();

		renderWithProviders(<VerifyEmailPage />, {
			locale: 'en',
			route: `/verify-email?token=${TOKEN}`,
			store,
		});

		await waitFor(() => expect(slow.requests).toHaveLength(1));
		store.dispatch(sessionCleared());
		slow.release();

		expect(await screen.findByText('E-mail confirmed')).toBeInTheDocument();
		expect(slow.aborted).toEqual([]);
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

	it('says the server is unreachable instead of spinning forever', async () => {
		vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
		renderWithProviders(<VerifyEmailPage />, {
			locale: 'en',
			route: `/verify-email?token=${TOKEN}`,
		});

		const alert = await screen.findByRole('alert');
		expect(alert).toHaveTextContent('Could not connect. Check your internet.');
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
