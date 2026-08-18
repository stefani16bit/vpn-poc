import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';

import { renderWithProviders } from '@/test-utils.tsx';
import { AppShell } from './app-shell.tsx';

function renderShell() {
	return renderWithProviders(
		<Routes>
			<Route element={<AppShell />}>
				<Route path="/somewhere" element={<p>the page</p>} />
			</Route>
		</Routes>,
		{ locale: 'en', route: '/somewhere' },
	);
}

describe('AppShell', () => {
	it('renders the route it frames', () => {
		renderShell();

		expect(screen.getByText('the page')).toBeInTheDocument();
	});

	it('owns the main landmark the skip link points at', () => {
		renderShell();

		expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
	});

	it('carries the theme toggle for every framed route', () => {
		renderShell();

		expect(screen.getByRole('button', { name: /Theme/ })).toBeInTheDocument();
	});
});
