import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from '@/components/ui/input.tsx';
import { renderWithProviders } from '@/test-utils.tsx';
import { Field } from './field.tsx';

function renderField(error?: string) {
	return renderWithProviders(
		<Field label="E-mail" error={error}>
			{(control) => <Input type="email" {...control} />}
		</Field>,
		{ locale: 'en' },
	);
}

describe('Field', () => {
	it('associates the label with the control', () => {
		renderField();
		expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
	});

	it('leaves the control valid when there is no error', () => {
		renderField();
		const input = screen.getByLabelText('E-mail');

		expect(input).toHaveAttribute('aria-invalid', 'false');
		expect(input).not.toHaveAttribute('aria-describedby');
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
	});

	it('marks the control invalid and points it at the message', () => {
		renderField('errors.VALIDATION_FAILED');
		const input = screen.getByLabelText('E-mail');
		const message = screen.getByRole('alert');

		expect(input).toHaveAttribute('aria-invalid', 'true');
		expect(input.getAttribute('aria-describedby')).toBe(message.id);
	});

	it('translates the error, because the message is a key not a sentence', () => {
		renderField('errors.INVALID_CREDENTIALS');
		expect(screen.getByRole('alert').textContent).not.toBe('errors.INVALID_CREDENTIALS');
	});

	it('gives each field its own ids, so two fields do not collide', () => {
		renderWithProviders(
			<>
				<Field label="E-mail" error="errors.INVALID_CREDENTIALS">
					{(control) => <Input {...control} />}
				</Field>
				<Field label="Password" error="errors.INVALID_CREDENTIALS">
					{(control) => <Input {...control} />}
				</Field>
			</>,
			{ locale: 'en' },
		);

		const [first, second] = screen.getAllByRole('alert');
		expect(first?.id).not.toBe(second?.id);
		expect(screen.getByLabelText('E-mail')).toHaveAttribute('aria-describedby', first?.id);
		expect(screen.getByLabelText('Password')).toHaveAttribute('aria-describedby', second?.id);
	});
});
