import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { NormalizedError } from '@/app/store/api-error.js';
import { renderWithProviders } from '@/test-utils.tsx';
import { FormError } from './form-error.tsx';

function error(overrides: Partial<NormalizedError> = {}): NormalizedError {
	return {
		code: 'INVALID_CREDENTIALS',
		message: 'nope',
		status: 401,
		correlationId: null,
		fields: null,
		...overrides,
	} as NormalizedError;
}

describe('FormError', () => {
	it('renders nothing when there is no error', () => {
		renderWithProviders(<FormError error={null} />, { locale: 'en' });
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('renders nothing for a validation failure, which the fields already show', () => {
		renderWithProviders(<FormError error={error({ code: 'VALIDATION_FAILED' })} />, {
			locale: 'en',
		});
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('announces the translated code, never the developer message', () => {
		renderWithProviders(<FormError error={error()} />, { locale: 'en' });

		const alert = screen.getByRole('alert');
		expect(alert).toBeInTheDocument();
		expect(alert).not.toHaveTextContent('nope');
		expect(alert).not.toHaveTextContent('INVALID_CREDENTIALS');
	});

	it('shows the correlation id when the response carried one', () => {
		renderWithProviders(<FormError error={error({ correlationId: 'corr-1' })} />, {
			locale: 'en',
		});
		expect(screen.getByRole('alert')).toHaveTextContent('corr-1');
	});

	it('omits the correlation line when there is none to quote', () => {
		renderWithProviders(<FormError error={error()} />, { locale: 'en' });
		expect(screen.getByRole('alert').textContent).not.toContain(':');
	});
});
