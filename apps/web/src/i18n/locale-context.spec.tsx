import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider, readStoredLocale, useLocale } from './locale-context.js';

function Probe() {
	const { locale, t, setLocale } = useLocale();
	return (
		<div>
			<span data-testid="locale">{locale}</span>
			<span data-testid="title">{t('auth.login.title')}</span>
			<button type="button" onClick={() => setLocale('en')}>
				switch
			</button>
		</div>
	);
}

function stubBrowserLanguage(language: string) {
	vi.spyOn(window.navigator, 'language', 'get').mockReturnValue(language);
}

beforeEach(() => {
	window.localStorage.clear();
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

describe('readStoredLocale', () => {
	it('prefers what the user stored', () => {
		stubBrowserLanguage('en-US');
		window.localStorage.setItem('poc-vpn.locale', 'pt-BR');
		expect(readStoredLocale()).toBe('pt-BR');
	});

	it('negotiates from the browser when a stored value is not supported', () => {
		stubBrowserLanguage('en-US');
		window.localStorage.setItem('poc-vpn.locale', 'klingon');
		expect(readStoredLocale()).toBe('en');
	});

	it('negotiates from the browser when nothing is stored', () => {
		stubBrowserLanguage('pt-PT');
		expect(readStoredLocale()).toBe('pt-BR');
	});

	it('falls back when the browser language is one we do not carry', () => {
		stubBrowserLanguage('fr-FR');
		expect(readStoredLocale()).toBe('pt-BR');
	});
});

describe('LocaleProvider', () => {
	it('translates through the context', () => {
		stubBrowserLanguage('pt-BR');
		render(
			<LocaleProvider>
				<Probe />
			</LocaleProvider>,
		);

		expect(screen.getByTestId('locale').textContent).toBe('pt-BR');
		expect(screen.getByTestId('title').textContent).toBe('Entrar');
	});

	it('switches language and persists the choice', async () => {
		stubBrowserLanguage('pt-BR');
		render(
			<LocaleProvider>
				<Probe />
			</LocaleProvider>,
		);

		screen.getByRole('button', { name: 'switch' }).click();

		expect(await screen.findByText('Sign in')).toBeInTheDocument();
		expect(window.localStorage.getItem('poc-vpn.locale')).toBe('en');
	});

	it('refuses to be used outside a provider', () => {
		expect(() => render(<Probe />)).toThrow(/LocaleProvider/);
	});
});
