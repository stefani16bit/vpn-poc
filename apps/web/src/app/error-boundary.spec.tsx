import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './error-boundary.tsx';

function Explodes(): never {
	throw new Error('boom');
}

beforeEach(() => {
	// React logs the caught error itself; the test asserts behaviour, not noise.
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
	it('renders its children while nothing is wrong', () => {
		render(
			<ErrorBoundary>
				<p>the app</p>
			</ErrorBoundary>,
		);
		expect(screen.getByText('the app')).toBeInTheDocument();
	});

	it('replaces a subtree that threw with a message the user can act on', () => {
		render(
			<ErrorBoundary>
				<Explodes />
			</ErrorBoundary>,
		);

		expect(screen.getByRole('heading')).toHaveTextContent('Something went wrong');
		expect(screen.getByText(/reload the page/i)).toBeInTheDocument();
	});

	it('does not leak the thrown message to the user', () => {
		render(
			<ErrorBoundary>
				<Explodes />
			</ErrorBoundary>,
		);
		expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
	});

	it('renders without any provider, which is the whole point of it', () => {
		expect(() =>
			render(
				<ErrorBoundary>
					<Explodes />
				</ErrorBoundary>,
			),
		).not.toThrow();
	});
});
