import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-utils.tsx';
import { LanguagePicker } from './language-picker.tsx';

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	window.localStorage.clear();
});

describe('LanguagePicker', () => {
	it('is a labelled combobox, not a bare control', () => {
		renderWithProviders(<LanguagePicker />, { locale: 'en' });
		expect(screen.getByRole('combobox', { name: 'Language' })).toBeInTheDocument();
	});

	it('drops the visible label when compact, keeping the accessible name', () => {
		renderWithProviders(<LanguagePicker compact />, { locale: 'en' });

		expect(screen.getByRole('combobox', { name: 'Language' })).toBeInTheDocument();
		expect(screen.queryByText('Language')).not.toBeInTheDocument();
	});

	it('shows the active language in its own name', () => {
		renderWithProviders(<LanguagePicker />, { locale: 'en' });
		expect(screen.getByRole('combobox')).toHaveTextContent('English');
	});

	it('names each language in that language, not the current one', async () => {
		renderWithProviders(<LanguagePicker />, { locale: 'en' });

		await userEvent.click(screen.getByRole('combobox'));

		expect(await screen.findByRole('option', { name: 'English' })).toBeInTheDocument();
		expect(screen.getByRole('option', { name: 'Português (Brasil)' })).toBeInTheDocument();
	});

	it('switches the app language when an option is chosen', async () => {
		renderWithProviders(<LanguagePicker />, { locale: 'en' });

		await userEvent.click(screen.getByRole('combobox'));
		await userEvent.click(await screen.findByRole('option', { name: 'Português (Brasil)' }));

		await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('Português'));
	});

	it('remembers the choice for the next visit', async () => {
		renderWithProviders(<LanguagePicker />, { locale: 'en' });

		await userEvent.click(screen.getByRole('combobox'));
		await userEvent.click(await screen.findByRole('option', { name: 'Português (Brasil)' }));

		await waitFor(() => expect(window.localStorage.getItem('poc-vpn.locale')).toBe('pt-BR'));
	});
});
