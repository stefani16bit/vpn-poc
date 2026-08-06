import { waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-utils.tsx';
import { useLocale } from './locale-context.tsx';

function Switcher() {
	const { setLocale } = useLocale();
	return (
		<button type="button" onClick={() => setLocale('pt-BR')}>
			switch
		</button>
	);
}

beforeEach(() => {
	window.localStorage.clear();
	document.documentElement.lang = 'xx';
});

afterEach(() => {
	window.localStorage.clear();
});

describe('LocaleProvider and document.lang', () => {
	it('stamps the active locale onto the document on mount', async () => {
		renderWithProviders(<Switcher />, { locale: 'en' });
		await waitFor(() => expect(document.documentElement.lang).toBe('en'));
	});

	it('follows a locale change, so the page is never announced in the wrong language', async () => {
		renderWithProviders(<Switcher />, { locale: 'en' });
		await waitFor(() => expect(document.documentElement.lang).toBe('en'));

		await userEvent.click(screen.getByRole('button', { name: 'switch' }));

		await waitFor(() => expect(document.documentElement.lang).toBe('pt-BR'));
	});
});
