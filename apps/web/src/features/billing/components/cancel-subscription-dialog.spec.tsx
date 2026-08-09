import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { SubscriptionResponse } from '@vpn/contracts';

import { renderWithProviders } from '@/test-utils.tsx';
import { CancelSubscriptionDialog } from './cancel-subscription-dialog.tsx';

function subscription(overrides: Partial<SubscriptionResponse> = {}): SubscriptionResponse {
	return {
		status: 'active',
		currentPeriodEnd: '2026-09-01T00:00:00.000Z',
		cancelAtPeriodEnd: false,
		...overrides,
	};
}

function render(props: Partial<Parameters<typeof CancelSubscriptionDialog>[0]> = {}) {
	const onConfirm = props.onConfirm ?? vi.fn();
	renderWithProviders(
		<CancelSubscriptionDialog
			subscription={props.subscription ?? subscription()}
			pending={props.pending ?? false}
			onConfirm={onConfirm}
		/>,
		{ locale: 'en' },
	);
	return { onConfirm };
}

describe('CancelSubscriptionDialog', () => {
	it('shows only the trigger until it is opened', () => {
		render();

		expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeInTheDocument();
		expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
	});

	it('asks before cancelling anything', async () => {
		const { onConfirm } = render();

		await userEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }));

		expect(await screen.findByRole('alertdialog')).toHaveTextContent('Cancel your subscription?');
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it('says how long access lasts, using the date the subscription carries', async () => {
		render();

		await userEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }));

		const dialog = await screen.findByRole('alertdialog');
		expect(dialog).toHaveTextContent(
			new RegExp(
				`Access continues until ${new Date('2026-09-01T00:00:00.000Z').toLocaleDateString('en')}\\.`,
			),
		);
	});

	it('falls back to naming the period instead of printing an empty date', async () => {
		render({ subscription: subscription({ currentPeriodEnd: null }) });

		await userEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }));

		expect(await screen.findByRole('alertdialog')).toHaveTextContent(
			'Access continues until the end of the current period.',
		);
	});

	it('cancels nothing when the dialog is dismissed', async () => {
		const { onConfirm } = render();

		await userEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Keep my subscription' }));

		expect(onConfirm).not.toHaveBeenCalled();
		expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
	});

	it('confirms exactly once when accepted', async () => {
		const { onConfirm } = render();

		await userEvent.click(screen.getByRole('button', { name: 'Cancel subscription' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Yes, cancel' }));

		expect(onConfirm).toHaveBeenCalledOnce();
	});

	it('does not offer the trigger while a request is already in flight', () => {
		render({ pending: true });

		expect(screen.getByRole('button', { name: 'Cancel subscription' })).toBeDisabled();
	});
});
