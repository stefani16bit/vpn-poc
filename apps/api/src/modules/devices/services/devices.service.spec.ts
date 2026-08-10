import { describe, expect, it, vi } from 'vitest';

import type { CreateDeviceRequest } from '@vpn/contracts';
import { FixedClock } from '@vpn/testing/fakes';
import type { Env } from '@vpn-poc/env';

import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import type {
	DeviceRepository,
	NewDevice,
	StoredDevice,
} from '../../../shared/devices/device.repository.js';
import type { ExitNodeDirectory } from '../../../shared/devices/exit-node-directory.service.js';
import type { UserRepository } from '../../../shared/identity/repositories/user.repository.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { OutboxRepository } from '../../../shared/outbox/outbox.repository.js';
import { DevicesService } from './devices.service.js';

const CIDR = '10.13.13.0/24';
const ACCOUNT = 'account-1';
const USER = 'user-1';
const OWNER_EMAIL = 'owner@example.com';
const REQUEST: CreateDeviceRequest = {
	name: 'laptop',
	publicKey: 'hAcCPVXqcJRVvi/JIn1jjnpUAxbfEbAJPBUlkAcO8k4=',
};

function duplicateKey() {
	return { code: '23505', constraint_name: 'devices_live_public_key_key' };
}

function stored(values: NewDevice): StoredDevice {
	return {
		id: `device-${values.tunnelAddress}`,
		accountId: values.accountId,
		userId: values.userId,
		name: values.name,
		publicKey: values.publicKey,
		tunnelAddress: values.tunnelAddress,
		provisionedAt: null,
		revokedAt: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
	};
}

function claims(overrides: Partial<AccessTokenClaims> = {}): AccessTokenClaims {
	return {
		userId: USER,
		accountId: ACCOUNT,
		role: 'member',
		sessionId: 'session-1',
		emailVerified: true,
		...overrides,
	};
}

function service({
	taken = new Set<string>(),
	claim,
	revoked,
}: {
	taken?: ReadonlySet<string>;
	claim?: (values: NewDevice) => Promise<StoredDevice | undefined>;
	revoked?: StoredDevice | undefined;
} = {}) {
	const claimAddress = vi.fn(claim ?? ((values: NewDevice) => Promise.resolve(stored(values))));
	const revoke = vi.fn(() => Promise.resolve(revoked));
	const listLive = vi.fn(() => Promise.resolve([]));
	const devices = {
		takenAddresses: vi.fn(() => Promise.resolve(taken)),
		claimAddress,
		listLive,
		revoke,
	} as unknown as DeviceRepository;

	const users = {
		findById: () => Promise.resolve({ id: USER, email: OWNER_EMAIL }),
	} as unknown as UserRepository;

	const enqueue = vi.fn(() => Promise.resolve());
	const outbox = { enqueue } as unknown as OutboxRepository;

	const directory = {
		current: () =>
			Promise.resolve({
				publicKey: 'rKCjjZR5cgoZSG0BE1Cjs5wHcOAOYU5Vweb/Gj0rPWg=',
				endpoint: '127.0.0.1:21820',
				allowedIps: ['10.13.13.0/24'],
			}),
	} as unknown as ExitNodeDirectory;

	const subject = new DevicesService(devices, users, outbox, directory, new FixedClock(), {
		EXIT_NODE_TUNNEL_CIDR: CIDR,
	} as Env);

	return { subject, claimAddress, enqueue, listLive, revoke };
}

describe('DevicesService.create', () => {
	it('claims once when the range is empty', async () => {
		const { subject, claimAddress } = service();

		const created = await subject.create(ACCOUNT, USER, REQUEST);

		expect(claimAddress).toHaveBeenCalledTimes(1);
		expect(created.device.tunnelAddress).toBe('10.13.13.4/32');
	});

	it('claims once when two hundred addresses are already gone', async () => {
		const taken = new Set(
			Array.from({ length: 197 }, (_unused, index) => `10.13.13.${index + 4}/32`),
		);
		const { subject, claimAddress } = service({ taken });

		const created = await subject.create(ACCOUNT, USER, REQUEST);

		expect(claimAddress).toHaveBeenCalledTimes(1);
		expect(created.device.tunnelAddress).toBe('10.13.13.201/32');
	});

	it('takes the hole a revoked device left rather than the end of the range', async () => {
		const taken = new Set(
			Array.from({ length: 197 }, (_unused, index) => `10.13.13.${index + 4}/32`),
		);
		taken.delete('10.13.13.9/32');
		const { subject } = service({ taken });

		expect((await subject.create(ACCOUNT, USER, REQUEST)).device.tunnelAddress).toBe(
			'10.13.13.9/32',
		);
	});

	it('tries the next address when the hint lost a race, because the index decides', async () => {
		let attempts = 0;
		const { subject, claimAddress } = service({
			claim: (values) => {
				attempts += 1;
				return Promise.resolve(attempts === 1 ? undefined : stored(values));
			},
		});

		const created = await subject.create(ACCOUNT, USER, REQUEST);

		expect(claimAddress).toHaveBeenCalledTimes(2);
		expect(created.device.tunnelAddress).toBe('10.13.13.5/32');
	});

	it('names the public key when that is the index that refused', async () => {
		const { subject, claimAddress } = service({ claim: () => Promise.reject(duplicateKey()) });

		await expect(subject.create(ACCOUNT, USER, REQUEST)).rejects.toThrow(
			new AppError('CONFLICT', 'this public key already belongs to a live device'),
		);
		expect(claimAddress).toHaveBeenCalledTimes(1);
	});

	it('does not turn an unrelated failure into a conflict', async () => {
		const { subject } = service({ claim: () => Promise.reject(new Error('connection lost')) });

		await expect(subject.create(ACCOUNT, USER, REQUEST)).rejects.toThrow('connection lost');
	});

	it('reports the range as full only after trying all of it', async () => {
		const { subject, claimAddress } = service({ claim: () => Promise.resolve(undefined) });

		await expect(subject.create(ACCOUNT, USER, REQUEST)).rejects.toThrow('no free address left');
		expect(claimAddress).toHaveBeenCalledTimes(251);
	});

	it('writes the provisioning intention next to the row', async () => {
		const { subject, enqueue } = service();

		await subject.create(ACCOUNT, USER, REQUEST);

		expect(enqueue).toHaveBeenCalledWith(ACCOUNT, {
			kind: 'device.provision',
			deviceId: 'device-10.13.13.4/32',
		});
	});
});

describe('DevicesService.revoke', () => {
	const LIVE = stored({
		accountId: ACCOUNT,
		userId: USER,
		name: 'laptop',
		publicKey: REQUEST.publicKey,
		tunnelAddress: '10.13.13.4/32',
	});

	it('asks only for a device the member owns', async () => {
		const { subject, revoke } = service({ revoked: LIVE });

		await subject.revoke(claims(), LIVE.id);

		expect(revoke).toHaveBeenCalledWith(LIVE.id, { ownedBy: USER }, expect.any(Date));
	});

	it('lets an admin reach the whole account, because offboarding is not self-service', async () => {
		const { subject, revoke } = service({ revoked: LIVE });

		await subject.revoke(claims({ role: 'admin', userId: 'someone-else' }), LIVE.id);

		expect(revoke).toHaveBeenCalledWith(LIVE.id, { wholeAccount: true }, expect.any(Date));
	});

	it('lets an owner reach it too', async () => {
		const { subject, revoke } = service({ revoked: LIVE });

		await subject.revoke(claims({ role: 'owner', userId: 'someone-else' }), LIVE.id);

		expect(revoke).toHaveBeenCalledWith(LIVE.id, { wholeAccount: true }, expect.any(Date));
	});

	it('tells the node to forget the key once the row stops counting', async () => {
		const { subject, enqueue } = service({ revoked: LIVE });

		await subject.revoke(claims(), LIVE.id);

		expect(enqueue).toHaveBeenCalledWith(ACCOUNT, {
			kind: 'device.revoke',
			publicKey: LIVE.publicKey,
		});
	});

	it('says nothing was found rather than that it was forbidden', async () => {
		const { subject, enqueue } = service({ revoked: undefined });

		await expect(subject.revoke(claims(), LIVE.id)).rejects.toThrow(
			new AppError('NOT_FOUND', 'no live device with that id'),
		);
		expect(enqueue).not.toHaveBeenCalled();
	});
});

describe('DevicesService.list', () => {
	it('shows a member only what they own', async () => {
		const { subject, listLive } = service();

		await subject.list(claims());

		expect(listLive).toHaveBeenCalledWith({ ownedBy: USER });
	});

	it('shows an admin the whole account, which is what offboarding needs to see', async () => {
		const { subject, listLive } = service();

		await subject.list(claims({ role: 'admin' }));

		expect(listLive).toHaveBeenCalledWith({ wholeAccount: true });
	});

	it('shows an owner the whole account too', async () => {
		const { subject, listLive } = service();

		await subject.list(claims({ role: 'owner' }));

		expect(listLive).toHaveBeenCalledWith({ wholeAccount: true });
	});
});
