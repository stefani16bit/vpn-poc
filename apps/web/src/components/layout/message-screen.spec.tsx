import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-utils.tsx';
import { AuthCard } from './auth-card.tsx';
import { Loading } from './loading.tsx';
import { MessageScreen } from './message-screen.tsx';

describe('MessageScreen', () => {
	it('moves focus to the heading, because it replaced the focused form', () => {
		renderWithProviders(<MessageScreen title="Check your inbox" />, { locale: 'en' });
		expect(screen.getByText('Check your inbox')).toHaveFocus();
	});

	it('takes focus without becoming a tab stop', () => {
		renderWithProviders(<MessageScreen title="Check your inbox" />, { locale: 'en' });
		expect(screen.getByText('Check your inbox')).toHaveAttribute('tabindex', '-1');
	});

	it('renders the body when there is one', () => {
		renderWithProviders(<MessageScreen title="Done">we sent you a link</MessageScreen>, {
			locale: 'en',
		});
		expect(screen.getByText('we sent you a link')).toBeInTheDocument();
	});

	it('renders a title-only screen without an empty body', () => {
		const { container } = renderWithProviders(<MessageScreen title="Done" />, { locale: 'en' });
		expect(container.querySelector('[data-slot="card-content"]')).toBeNull();
	});
});

describe('AuthCard', () => {
	it('renders its title and its children', () => {
		renderWithProviders(
			<AuthCard title="Sign in">
				<p>form goes here</p>
			</AuthCard>,
			{ locale: 'en' },
		);

		expect(screen.getByText('Sign in')).toBeInTheDocument();
		expect(screen.getByText('form goes here')).toBeInTheDocument();
	});

	it('does not steal focus, unlike the terminal screens', () => {
		renderWithProviders(
			<AuthCard title="Sign in">
				<p>body</p>
			</AuthCard>,
			{ locale: 'en' },
		);
		expect(screen.getByText('Sign in')).not.toHaveFocus();
	});
});

describe('Loading', () => {
	it('announces itself as a status region', () => {
		renderWithProviders(<Loading />, { locale: 'en' });
		expect(screen.getByRole('status')).toHaveTextContent('Loading');
	});

	it('follows the locale', () => {
		renderWithProviders(<Loading />, { locale: 'pt-BR' });
		expect(screen.getByRole('status')).toHaveTextContent('Carregando');
	});
});
