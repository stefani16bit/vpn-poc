import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { RevokeDeviceDialog } from '@/features/keys/components/revoke-device-dialog.tsx';
import { renderWithProviders } from '@/test-utils.tsx';

function render(props: { pending?: boolean } = {}) {
	const onConfirm = vi.fn();
	renderWithProviders(
		<RevokeDeviceDialog name="laptop" pending={props.pending ?? false} onConfirm={onConfirm} />,
		{ locale: 'en' },
	);
	return { onConfirm };
}

describe('RevokeDeviceDialog', () => {
	it('shows the trigger and nothing else until it is asked', () => {
		render();

		expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
		expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
	});

	it('asks before revoking anything', async () => {
		const { onConfirm } = render();

		await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));

		expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
		expect(onConfirm).not.toHaveBeenCalled();
	});

	it('names the device being revoked, since the page lists several', async () => {
		render();

		await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));

		expect(await screen.findByText(/laptop/)).toBeInTheDocument();
	});

	it('warns that the tunnel on the client stays up, which is why tunnel:doctor exists', async () => {
		render();

		await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
		const dialog = await screen.findByRole('alertdialog');

		expect(dialog).toHaveTextContent(/still show the tunnel as up/i);
		expect(dialog).toHaveTextContent(/delete the tunnel in the app/i);
	});

	it('does not promise the tunnel dies immediately, because the outbox delivers it', async () => {
		render();

		await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));

		expect(await screen.findByRole('alertdialog')).not.toHaveTextContent(/immediately/i);
	});

	it('revokes nothing when the dialog is dismissed', async () => {
		const { onConfirm } = render();

		await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Keep device' }));

		expect(onConfirm).not.toHaveBeenCalled();
	});

	it('revokes exactly once when confirmed', async () => {
		const { onConfirm } = render();

		await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
		await userEvent.click(await screen.findByRole('button', { name: 'Yes, revoke' }));

		expect(onConfirm).toHaveBeenCalledOnce();
	});

	it('cannot be opened while another revoke is in flight', () => {
		render({ pending: true });

		expect(screen.getByRole('button', { name: 'Revoke' })).toBeDisabled();
	});
});
