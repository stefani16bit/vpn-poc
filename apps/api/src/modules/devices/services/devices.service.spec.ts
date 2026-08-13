import { describe, expect, it, vi } from 'vitest';

import type { CreateDeviceRequest, Permission } from '@vpn/contracts';
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
import type { EntitlementsService } from '../../../shared/entitlements/entitlements.service.js';
import type { PermissionService } from '../../../shared/permissions/permission.service.js';
import { DevicesService } from './devices.service.js';

const CIDR = '10.13.13.0/24';
const ACCOUNT = 'account-1';
const USER = 'user-1';
const COLLEAGUE = 'user-2';
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
	granted = [],
	members = [{ id: USER, email: OWNER_EMAIL }],
	slots = new Set<number>(),
	ceiling = { seats: 25, devicesPerUser: 5 },
}: {
	taken?: ReadonlySet<string>;
	claim?: (values: NewDevice) => Promise<StoredDevice | undefined>;
	revoked?: StoredDevice | undefined;
	granted?: readonly Permission[];
	members?: readonly { id: string; email: string }[];
	slots?: ReadonlySet<number>;
	ceiling?: { seats: number; devicesPerUser: number };
} = {}) {
	const claimAddress = vi.fn(claim ?? ((values: NewDevice) => Promise.resolve(stored(values))));
	const revoke = vi.fn(() => Promise.resolve(revoked));
	const listLive = vi.fn(() => Promise.resolve([]));
	const devices = {
		takenAddresses: vi.fn(() => Promise.resolve(taken)),
		takenSlots: vi.fn(() => Promise.resolve(slots)),
		claimAddress,
		listLive,
		revoke,
	} as unknown as DeviceRepository;

	const listByAccount = vi.fn(() => Promise.resolve(members));
	const users = {
		findById: (id: string) => Promise.resolve(members.find((member) => member.id === id)),
		listByAccount,
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

	const has = vi.fn((_account: string, _user: string, _role: string, permission: Permission) =>
		Promise.resolve(granted.includes(permission)),
	);
	const permissions = { has } as unknown as PermissionService;

	const entitlements = {
		forAccount: () => Promise.resolve({ tier: 'pro', entitlements: ceiling }),
	} as unknown as EntitlementsService;

	const subject = new DevicesService(
		devices,
		users,
		outbox,
		directory,
		permissions,
		entitlements,
		new FixedClock(),
		{ EXIT_NODE_TUNNEL_CIDR: CIDR } as Env,
	);

	return { subject, claimAddress, enqueue, listLive, listByAccount, revoke };
}

describe('DevicesService.create', () => {
	it('claims once when the range is empty', async () => {
		const { subject, claimAddress } = service();

		const created = await subject.create(claims(), REQUEST);

		expect(claimAddress).toHaveBeenCalledTimes(1);
		expect(created.device.tunnelAddress).toBe('10.13.13.4/32');
	});

	it('claims once when two hundred addresses are already gone', async () => {
		const taken = new Set(
			Array.from({ length: 197 }, (_unused, index) => `10.13.13.${index + 4}/32`),
		);
		const { subject, claimAddress } = service({ taken });

		const created = await subject.create(claims(), REQUEST);

		expect(claimAddress).toHaveBeenCalledTimes(1);
		expect(created.device.tunnelAddress).toBe('10.13.13.201/32');
	});

	it('takes the hole a revoked device left rather than the end of the range', async () => {
		const taken = new Set(
			Array.from({ length: 197 }, (_unused, index) => `10.13.13.${index + 4}/32`),
		);
		taken.delete('10.13.13.9/32');
		const { subject } = service({ taken });

		expect((await subject.create(claims(), REQUEST)).device.tunnelAddress).toBe('10.13.13.9/32');
	});

	it('tries the next address when the hint lost a race, because the index decides', async () => {
		let attempts = 0;
		const { subject, claimAddress } = service({
			claim: (values) => {
				attempts += 1;
				return Promise.resolve(attempts === 1 ? undefined : stored(values));
			},
		});

		const created = await subject.create(claims(), REQUEST);

		expect(claimAddress).toHaveBeenCalledTimes(2);
		expect(created.device.tunnelAddress).toBe('10.13.13.5/32');
	});

	it('names the public key when that is the index that refused', async () => {
		const { subject, claimAddress } = service({ claim: () => Promise.reject(duplicateKey()) });

		await expect(subject.create(claims(), REQUEST)).rejects.toThrow(
			new AppError('CONFLICT', 'this public key already belongs to a live device'),
		);
		expect(claimAddress).toHaveBeenCalledTimes(1);
	});

	it('does not turn an unrelated failure into a conflict', async () => {
		const { subject } = service({ claim: () => Promise.reject(new Error('connection lost')) });

		await expect(subject.create(claims(), REQUEST)).rejects.toThrow('connection lost');
	});

	it('reports the range as full only after trying all of it', async () => {
		const { subject, claimAddress } = service({ claim: () => Promise.resolve(undefined) });

		await expect(subject.create(claims(), REQUEST)).rejects.toThrow('no free address left');
		expect(claimAddress).toHaveBeenCalledTimes(251);
	});

	it('writes the provisioning intention next to the row', async () => {
		const { subject, enqueue } = service();

		await subject.create(claims(), REQUEST);

		expect(enqueue).toHaveBeenCalledWith(ACCOUNT, {
			kind: 'device.provision',
			deviceId: 'device-10.13.13.4/32',
		});
	});

	it('reads an absent owner as "for me", so the common case asks for nothing extra', async () => {
		const { subject, claimAddress } = service();

		await subject.create(claims(), REQUEST);

		expect(claimAddress).toHaveBeenCalledWith(expect.objectContaining({ userId: USER }));
	});

	it('refuses to put a key in somebody else name without devices.assign', async () => {
		const { subject, claimAddress } = service({
			granted: ['devices.create'],
			members: [
				{ id: USER, email: OWNER_EMAIL },
				{ id: COLLEAGUE, email: 'bruno@example.com' },
			],
		});

		await expect(subject.create(claims(), { ...REQUEST, userId: COLLEAGUE })).rejects.toThrow(
			new AppError('FORBIDDEN', 'assigning a device to another user needs devices.assign'),
		);
		expect(claimAddress).not.toHaveBeenCalled();
	});

	it('lets the holder of devices.assign choose the owner', async () => {
		const { subject, claimAddress } = service({
			granted: ['devices.create', 'devices.assign'],
			members: [
				{ id: USER, email: OWNER_EMAIL },
				{ id: COLLEAGUE, email: 'bruno@example.com' },
			],
		});

		const created = await subject.create(claims(), { ...REQUEST, userId: COLLEAGUE });

		expect(claimAddress).toHaveBeenCalledWith(expect.objectContaining({ userId: COLLEAGUE }));
		expect(created.device.userEmail).toBe('bruno@example.com');
	});

	it('does not ask for devices.assign when the chosen owner is the caller', async () => {
		const { subject, claimAddress } = service();

		await subject.create(claims(), { ...REQUEST, userId: USER });

		expect(claimAddress).toHaveBeenCalledWith(expect.objectContaining({ userId: USER }));
	});

	describe('the ceiling the plan bought', () => {
		it('takes the lowest free seat, so a revoked one is reused', async () => {
			const { subject, claimAddress } = service({ slots: new Set([0, 2]) });

			await subject.create(claims(), REQUEST);

			expect(claimAddress).toHaveBeenCalledWith(expect.objectContaining({ accountSlot: 1 }));
		});

		// The address range is global. Without this, one tenant takes all 251 and
		// every neighbour stops being able to create a key.
		it('refuses once the account holds every seat the plan bought', async () => {
			const { subject, claimAddress } = service({
				ceiling: { seats: 2, devicesPerUser: 2 },
				slots: new Set([0, 1, 2, 3]),
			});

			await expect(subject.create(claims(), REQUEST)).rejects.toThrow(
				new AppError(
					'QUOTA_EXCEEDED',
					'the plan allows 4 live devices and the account already has that many',
				),
			);
			expect(claimAddress).not.toHaveBeenCalled();
		});

		// The count is a hint; the index is the rule. Two requests reading the same
		// free seat is exactly what it is there for.
		it('moves to the next seat when another request took the one it read', async () => {
			let attempts = 0;
			const { subject, claimAddress } = service({
				ceiling: { seats: 1, devicesPerUser: 3 },
				claim: (values: NewDevice) => {
					attempts += 1;
					if (attempts === 1) {
						return Promise.reject({
							code: '23505',
							constraint_name: 'devices_live_account_slot_key',
						});
					}
					return Promise.resolve(stored(values));
				},
			});

			await subject.create(claims(), REQUEST);

			expect(claimAddress).toHaveBeenNthCalledWith(1, expect.objectContaining({ accountSlot: 0 }));
			expect(claimAddress).toHaveBeenNthCalledWith(2, expect.objectContaining({ accountSlot: 1 }));
		});

		it('gives up with the quota rather than looping forever on lost races', async () => {
			const { subject } = service({
				ceiling: { seats: 1, devicesPerUser: 2 },
				claim: () =>
					Promise.reject({ code: '23505', constraint_name: 'devices_live_account_slot_key' }),
			});

			await expect(subject.create(claims(), REQUEST)).rejects.toThrow(
				new AppError(
					'QUOTA_EXCEEDED',
					'the plan allows 2 live devices and the account already has that many',
				),
			);
		});
	});
});

describe('DevicesService.assignees', () => {
	it('answers with the id and the address of everyone in the account', async () => {
		const { subject } = service({
			members: [
				{ id: USER, email: OWNER_EMAIL },
				{ id: COLLEAGUE, email: 'bruno@example.com' },
			],
		});

		expect(await subject.assignees(ACCOUNT)).toEqual({
			users: [
				{ id: USER, email: OWNER_EMAIL },
				{ id: COLLEAGUE, email: 'bruno@example.com' },
			],
		});
	});

	it('carries nothing the picker does not need', async () => {
		const { subject } = service();
		const [first] = (await subject.assignees(ACCOUNT)).users;

		expect(Object.keys(first ?? {}).sort()).toEqual(['email', 'id']);
	});
});

describe('DevicesService.revoke', () => {
	const LIVE = stored({
		accountId: ACCOUNT,
		userId: USER,
		name: 'laptop',
		publicKey: REQUEST.publicKey,
		tunnelAddress: '10.13.13.4/32',
		accountSlot: 0,
	});

	it('asks only for a device the member owns', async () => {
		const { subject, revoke } = service({ revoked: LIVE });

		await subject.revoke(claims(), LIVE.id);

		expect(revoke).toHaveBeenCalledWith(LIVE.id, { ownedBy: USER }, expect.any(Date));
	});

	it('reaches the whole account with devices.revokeAll, because offboarding is not self-service', async () => {
		const { subject, revoke } = service({ revoked: LIVE, granted: ['devices.revokeAll'] });

		await subject.revoke(claims({ role: 'admin', userId: 'someone-else' }), LIVE.id);

		expect(revoke).toHaveBeenCalledWith(LIVE.id, { wholeAccount: true }, expect.any(Date));
	});

	it('narrows back to ownership for an admin whose account took devices.revokeAll away', async () => {
		const { subject, revoke } = service({ revoked: LIVE, granted: ['devices.readAll'] });

		await subject.revoke(claims({ role: 'admin' }), LIVE.id);

		expect(revoke).toHaveBeenCalledWith(LIVE.id, { ownedBy: USER }, expect.any(Date));
	});

	it('does not let seeing every key imply cutting one off', async () => {
		const { subject, revoke } = service({ revoked: LIVE, granted: ['devices.readAll'] });

		await subject.revoke(claims({ role: 'member' }), LIVE.id);

		expect(revoke).toHaveBeenCalledWith(LIVE.id, { ownedBy: USER }, expect.any(Date));
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
	it('shows only what the caller owns when nothing widened the reach', async () => {
		const { subject, listLive } = service();

		await subject.list(claims());

		expect(listLive).toHaveBeenCalledWith({ ownedBy: USER });
	});

	it('shows the whole account with devices.readAll, which is what an audit needs to see', async () => {
		const { subject, listLive } = service({ granted: ['devices.readAll'] });

		await subject.list(claims());

		expect(listLive).toHaveBeenCalledWith({ wholeAccount: true });
	});

	it('narrows back for an admin whose account took devices.readAll away', async () => {
		const { subject, listLive } = service({ granted: ['devices.create'] });

		await subject.list(claims({ role: 'admin' }));

		expect(listLive).toHaveBeenCalledWith({ ownedBy: USER });
	});

	it('does not let cutting a key off imply seeing every key', async () => {
		const { subject, listLive } = service({ granted: ['devices.revokeAll'] });

		await subject.list(claims());

		expect(listLive).toHaveBeenCalledWith({ ownedBy: USER });
	});
});
