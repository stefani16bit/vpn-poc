import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-utils.tsx';
import { ThemeToggle } from './theme-toggle.tsx';

beforeEach(() => {
	window.localStorage.clear();
	document.documentElement.classList.remove('dark');
});

afterEach(() => {
	window.localStorage.clear();
});

describe('ThemeProvider', () => {
	it('defaults to dark when nothing was stored', async () => {
		renderWithProviders(<ThemeToggle />, { locale: 'en' });
		await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
	});

	it('honours a stored light preference', async () => {
		window.localStorage.setItem('poc-vpn.theme', 'light');
		renderWithProviders(<ThemeToggle />, { locale: 'en' });

		await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));
	});

	it('treats an unrecognised stored value as dark', async () => {
		window.localStorage.setItem('poc-vpn.theme', 'neon');
		renderWithProviders(<ThemeToggle />, { locale: 'en' });

		await waitFor(() => expect(document.documentElement).toHaveClass('dark'));
	});
});

describe('ThemeToggle', () => {
	it('flips the class on the document', async () => {
		renderWithProviders(<ThemeToggle />, { locale: 'en' });
		await waitFor(() => expect(document.documentElement).toHaveClass('dark'));

		await userEvent.click(screen.getByRole('button'));

		await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'));
	});

	it('remembers the choice, so a reload does not undo it', async () => {
		renderWithProviders(<ThemeToggle />, { locale: 'en' });
		await userEvent.click(screen.getByRole('button'));

		await waitFor(() => expect(window.localStorage.getItem('poc-vpn.theme')).toBe('light'));
	});

	it('names the theme it would switch to, not just an icon', () => {
		renderWithProviders(<ThemeToggle />, { locale: 'en' });
		expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Light');
	});

	it('flips the label once the theme has changed', async () => {
		renderWithProviders(<ThemeToggle />, { locale: 'en' });
		await userEvent.click(screen.getByRole('button'));

		await waitFor(() =>
			expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Dark'),
		);
	});
});
