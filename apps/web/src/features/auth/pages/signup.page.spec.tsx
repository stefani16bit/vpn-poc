import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders, stubApi, type ApiStub } from '@/test-utils.tsx';
import { SignupPage } from './signup.page.tsx';

let api: ApiStub;

beforeEach(() => {
	api = stubApi();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

async function fillAndSubmit(email = 'ada@example.com') {
	await userEvent.type(screen.getByLabelText('E-mail'), email);
	await userEvent.type(screen.getByLabelText('Password'), 'a-long-enough-password');
	await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
}

describe('SignupPage', () => {
	it('asks the browser for a new password, not the current one', () => {
		renderWithProviders(<SignupPage />, { locale: 'en' });
		expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
	});

	it('refuses an invalid address without calling the API', async () => {
		renderWithProviders(<SignupPage />, { locale: 'en' });

		await userEvent.type(screen.getByLabelText('E-mail'), 'not-an-email');
		await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

		await waitFor(() => expect(screen.getAllByRole('alert').length).toBeGreaterThan(0));
		expect(api.requests).toHaveLength(0);
	});

	it('registers with the locale the app is showing', async () => {
		api.reply({ acknowledged: true }, 202);
		renderWithProviders(<SignupPage />, { locale: 'en' });

		await fillAndSubmit();

		await waitFor(() => expect(api.lastRequest()).toBeDefined());
		expect(api.lastRequest()?.url).toContain('auth/register');
		expect(api.lastRequest()?.body).toMatchObject({ email: 'ada@example.com', locale: 'en' });
	});

	it('replaces the form with the check-inbox screen, naming the address', async () => {
		api.reply({ acknowledged: true }, 202);
		renderWithProviders(<SignupPage />, { locale: 'en' });

		await fillAndSubmit('grace@example.com');

		await waitFor(() => expect(screen.queryByLabelText('Password')).not.toBeInTheDocument());
		expect(screen.getByText(/grace@example.com/)).toBeInTheDocument();
	});

	it('moves focus to the heading of that screen', async () => {
		api.reply({ acknowledged: true }, 202);
		renderWithProviders(<SignupPage />, { locale: 'en' });

		await fillAndSubmit();

		await waitFor(() => expect(screen.getByText('Check your e-mail')).toHaveFocus());
	});

	it('keeps the form and explains a rate limit', async () => {
		api.fail('RATE_LIMITED', 429);
		renderWithProviders(<SignupPage />, { locale: 'en' });

		await fillAndSubmit();

		const alert = await screen.findByRole('alert');
		expect(alert).toHaveTextContent('corr-test');
		expect(alert).not.toHaveTextContent('developer detail');
		expect(screen.getByLabelText('Password')).toBeInTheDocument();
	});

	it('offers the way back to signing in', () => {
		renderWithProviders(<SignupPage />, { locale: 'en' });
		expect(screen.getByRole('link', { name: /sign in/i })).toHaveAttribute('href', '/login');
	});
});
