import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { useSelector } from 'react-redux';
import { Link, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { sessionResolved } from '@/app/store/auth-slice.js';
import type { RootState } from '@/app/store/index.js';
import { useTranslator } from '@/i18n/locale-context.tsx';
import { makeStore, renderWithProviders } from './test-utils.tsx';

function Probe() {
	const t = useTranslator();
	const status = useSelector((state: RootState) => state.auth.status);
	const location = useLocation();
	const [clicks, setClicks] = useState(0);

	return (
		<div>
			<p data-testid="translated">{t('common.loading')}</p>
			<p data-testid="status">{status}</p>
			<p data-testid="path">{location.pathname}</p>
			<button type="button" onClick={() => setClicks((value) => value + 1)}>
				clicked {clicks}
			</button>
			<Link to="/elsewhere">go</Link>
		</div>
	);
}

describe('renderWithProviders', () => {
	it('supplies a translator', () => {
		renderWithProviders(<Probe />, { locale: 'en' });
		expect(screen.getByTestId('translated')).toHaveTextContent('Loading');
	});

	it('translates according to the locale it was given', () => {
		renderWithProviders(<Probe />, { locale: 'pt-BR' });
		expect(screen.getByTestId('translated')).toHaveTextContent('Carregando');
	});

	it('supplies a store, and a fresh one per render by default', () => {
		const first = renderWithProviders(<Probe />);
		first.store.dispatch(
			sessionResolved({
				user: {
					id: 'acc-1',
					accountId: 'account-1',
					role: 'owner' as const,
					email: 'ada@example.com',
					emailVerified: true,
					locale: 'pt-BR',
					createdAt: '2026-01-01T00:00:00.000Z',
				},
				accessToken: 'token',
			}),
		);
		expect(first.store.getState().auth.status).toBe('authenticated');

		first.unmount();
		renderWithProviders(<Probe />);
		expect(screen.getByTestId('status')).toHaveTextContent('unknown');
	});

	it('accepts a store the test built, so state can be arranged up front', () => {
		const store = makeStore();
		store.dispatch(
			sessionResolved({
				user: {
					id: 'acc-1',
					accountId: 'account-1',
					role: 'owner' as const,
					email: 'ada@example.com',
					emailVerified: true,
					locale: 'pt-BR',
					createdAt: '2026-01-01T00:00:00.000Z',
				},
				accessToken: 'token',
			}),
		);

		renderWithProviders(<Probe />, { store });
		expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
	});

	it('starts at the route it was given', () => {
		renderWithProviders(<Probe />, { route: '/billing' });
		expect(screen.getByTestId('path')).toHaveTextContent('/billing');
	});

	it('supplies a router that navigates', async () => {
		renderWithProviders(<Probe />);
		await userEvent.click(screen.getByRole('link', { name: 'go' }));
		expect(screen.getByTestId('path')).toHaveTextContent('/elsewhere');
	});

	it('drives user events', async () => {
		renderWithProviders(<Probe />);
		await userEvent.click(screen.getByRole('button', { name: /clicked/ }));
		expect(screen.getByRole('button', { name: 'clicked 1' })).toBeInTheDocument();
	});
});
