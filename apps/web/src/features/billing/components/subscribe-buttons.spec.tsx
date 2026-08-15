import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test-utils.tsx';
import { SubscribeButtons } from './subscribe-buttons.tsx';

describe('SubscribeButtons', () => {
	it('offers both cadences, monthly first, when nothing was chosen beforehand', () => {
		renderWithProviders(<SubscribeButtons pending={false} onSubscribe={vi.fn()} />, {
			locale: 'en',
		});

		expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
			'Subscribe monthly',
			'Subscribe yearly',
		]);
	});

	it('says nothing about a choice nobody made', () => {
		renderWithProviders(<SubscribeButtons pending={false} onSubscribe={vi.fn()} />, {
			locale: 'en',
		});

		expect(screen.queryByText(/before creating your account/)).not.toBeInTheDocument();
	});

	it('names the cadence chosen on the landing, so the memory is visible', () => {
		renderWithProviders(
			<SubscribeButtons pending={false} onSubscribe={vi.fn()} preselected="yearly" />,
			{ locale: 'en' },
		);

		expect(
			screen.getByText('You chose the yearly plan before creating your account.'),
		).toBeInTheDocument();
	});

	it('puts the chosen cadence first instead of only restyling it', () => {
		renderWithProviders(
			<SubscribeButtons pending={false} onSubscribe={vi.fn()} preselected="yearly" />,
			{ locale: 'en' },
		);

		expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
			'Subscribe yearly',
			'Subscribe monthly',
		]);
	});

	it('leads with the chosen one, and leaves the other as the quieter option', () => {
		renderWithProviders(
			<SubscribeButtons pending={false} onSubscribe={vi.fn()} preselected="yearly" />,
			{ locale: 'en' },
		);

		expect(screen.getByRole('button', { name: 'Subscribe yearly' })).toHaveAttribute(
			'data-variant',
			'default',
		);
		expect(screen.getByRole('button', { name: 'Subscribe monthly' })).toHaveAttribute(
			'data-variant',
			'outline',
		);
	});

	it('still buys the cadence the button names, not the one that was remembered', async () => {
		const onSubscribe = vi.fn();
		const { default: userEvent } = await import('@testing-library/user-event');

		renderWithProviders(
			<SubscribeButtons pending={false} onSubscribe={onSubscribe} preselected="yearly" />,
			{ locale: 'en' },
		);

		await userEvent.click(screen.getByRole('button', { name: 'Subscribe monthly' }));

		expect(onSubscribe).toHaveBeenCalledWith('monthly');
	});
});
