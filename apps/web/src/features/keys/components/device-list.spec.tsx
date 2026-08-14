import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Device } from '@vpn/contracts';

import { DeviceList } from '@/features/keys/components/device-list.tsx';
import { renderWithProviders } from '@/test-utils.tsx';

function device(overrides: Partial<Device> = {}): Device {
	return {
		id: 'dev-1',
		name: 'laptop',
		publicKey: 'hAcCPVXqcJRVvi/JIn1jjnpUAxbfEbAJPBUlkAcO8k4=',
		tunnelAddress: '10.13.13.4/32',
		regionId: '22222222-2222-2222-2222-222222222222',
		exitNodeId: '33333333-3333-3333-3333-333333333333',
		userId: '11111111-1111-1111-1111-111111111111',
		userEmail: 'ada@example.com',
		provisionedAt: '2026-08-09T00:00:00.000Z',
		createdAt: '2026-08-09T00:00:00.000Z',
		...overrides,
	};
}

const ME = '11111111-1111-1111-1111-111111111111';

function render(devices: readonly Device[], { currentUserId = ME, canRevokeAny = true } = {}) {
	renderWithProviders(
		<DeviceList
			devices={devices}
			currentUserId={currentUserId}
			canRevokeAny={canRevokeAny}
			pending={false}
			onRevoke={vi.fn()}
		/>,
		{ locale: 'en' },
	);
}

describe('DeviceList', () => {
	it('says nothing about ownership when every device is one person', () => {
		render([device(), device({ id: 'dev-2', name: 'phone' })]);

		expect(screen.queryByText(/Belongs to/)).not.toBeInTheDocument();
	});

	it('names the owner once the list spans more than one person', () => {
		render([
			device(),
			device({
				id: 'dev-2',
				name: 'phone',
				userId: '22222222-2222-2222-2222-222222222222',
				userEmail: 'grace@example.com',
			}),
		]);

		expect(screen.getByText('Belongs to ada@example.com')).toBeInTheDocument();
		expect(screen.getByText('Belongs to grace@example.com')).toBeInTheDocument();
	});

	it('offers a revoke control per device, because an admin acts on somebody else', () => {
		render([
			device(),
			device({
				id: 'dev-2',
				name: 'phone',
				userId: '22222222-2222-2222-2222-222222222222',
				userEmail: 'grace@example.com',
			}),
		]);

		expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(2);
	});

	it('offers the empty state rather than an empty list', () => {
		render([]);

		expect(screen.getByText(/No devices yet/)).toBeInTheDocument();
	});

	it('keeps the revoke of your own key without any grant, because it is yours', () => {
		render([device()], { canRevokeAny: false });

		expect(screen.getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
	});

	it('offers no revoke against somebody else without devices.revokeAll', () => {
		render(
			[
				device(),
				device({
					id: 'dev-2',
					name: 'phone',
					userId: '22222222-2222-2222-2222-222222222222',
					userEmail: 'grace@example.com',
				}),
			],
			{ canRevokeAny: false },
		);

		expect(screen.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);
		expect(screen.getByText('Belongs to grace@example.com')).toBeInTheDocument();
	});
});
