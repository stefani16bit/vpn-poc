import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderWithProviders } from '@/test-utils.tsx';
import { SubmitButton } from './submit-button.tsx';

describe('SubmitButton', () => {
	it('submits the form it sits in', () => {
		renderWithProviders(<SubmitButton pending={false}>Sign in</SubmitButton>, { locale: 'en' });
		expect(screen.getByRole('button')).toHaveAttribute('type', 'submit');
	});

	it('shows its own label when idle', () => {
		renderWithProviders(<SubmitButton pending={false}>Sign in</SubmitButton>, { locale: 'en' });
		expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
	});

	it('swaps the label and disables itself while pending', () => {
		renderWithProviders(<SubmitButton pending>Sign in</SubmitButton>, { locale: 'en' });

		const button = screen.getByRole('button');
		expect(button).toBeDisabled();
		expect(button).not.toHaveTextContent('Sign in');
	});

	it('reports pending to assistive technology, not only visually', () => {
		renderWithProviders(<SubmitButton pending>Sign in</SubmitButton>, { locale: 'en' });
		expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
	});

	it('is not busy when idle', () => {
		renderWithProviders(<SubmitButton pending={false}>Sign in</SubmitButton>, { locale: 'en' });
		expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'false');
	});
});
