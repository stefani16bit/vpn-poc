import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Alert, AlertDescription, AlertTitle } from './alert.tsx';

describe('Alert', () => {
	it('announces itself to assistive technology', () => {
		render(<Alert>something went wrong</Alert>);
		expect(screen.getByRole('alert')).toHaveTextContent('something went wrong');
	});

	it('renders a title and a description together', () => {
		render(
			<Alert>
				<AlertTitle>title</AlertTitle>
				<AlertDescription>detail</AlertDescription>
			</Alert>,
		);

		const alert = screen.getByRole('alert');
		expect(alert).toHaveTextContent('title');
		expect(alert).toHaveTextContent('detail');
	});

	it('carries the destructive variant onto the element', () => {
		render(<Alert variant="destructive">bad</Alert>);
		expect(screen.getByRole('alert').className).toContain('text-destructive');
	});

	it('is not destructive by default', () => {
		render(<Alert>neutral</Alert>);
		expect(screen.getByRole('alert').className).not.toContain('text-destructive');
	});
});
