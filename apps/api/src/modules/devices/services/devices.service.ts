import { Inject, Injectable } from '@nestjs/common';

import type {
	CreateDeviceRequest,
	Device,
	DeviceAssigneeListResponse,
	DeviceWithNode,
	ExitNodeView,
	Permission,
} from '@vpn/contracts';
import { CLOCK, type IClock } from '@vpn/ports';
import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';

import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import { isUniqueViolation } from '../../../shared/database/pg-errors.js';
import {
	DeviceRepository,
	type DeviceScope,
	type NewDevice,
	type OwnedDevice,
	type StoredDevice,
} from '../../../shared/devices/device.repository.js';
import { ExitNodeDirectory } from '../../../shared/devices/exit-node-directory.service.js';
import { UserRepository } from '../../../shared/identity/repositories/user.repository.js';
import { assignableAddresses, firstFreeAddress } from '../../../shared/devices/tunnel-address.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { EntitlementsService } from '../../../shared/entitlements/entitlements.service.js';
import { OutboxRepository } from '../../../shared/outbox/outbox.repository.js';
import { PermissionService } from '../../../shared/permissions/permission.service.js';

const LIVE_PUBLIC_KEY_INDEX = 'devices_live_public_key_key';
const LIVE_ACCOUNT_SLOT_INDEX = 'devices_live_account_slot_key';

const TAKEN_SLOT = Symbol('taken slot');

export interface DeviceView {
	readonly device: DeviceWithNode;
}

@Injectable()
export class DevicesService {
	constructor(
		private readonly devices: DeviceRepository,
		private readonly users: UserRepository,
		private readonly outbox: OutboxRepository,
		private readonly directory: ExitNodeDirectory,
		private readonly permissions: PermissionService,
		private readonly entitlements: EntitlementsService,
		@Inject(CLOCK) private readonly clock: IClock,
		@Inject(ENV) private readonly env: Env,
	) {}

	async list(claims: AccessTokenClaims): Promise<{ devices: DeviceWithNode[] }> {
		const [stored, node] = await Promise.all([
			this.devices.listLive(await this.#scope(claims, 'devices.readAll')),
			this.#node(),
		]);

		return { devices: stored.map((device) => ({ ...toView(device), node })) };
	}

	async assignees(accountId: string): Promise<DeviceAssigneeListResponse> {
		const members = await this.users.listByAccount(accountId);

		return { users: members.map((member) => ({ id: member.id, email: member.email })) };
	}

	async create(claims: AccessTokenClaims, request: CreateDeviceRequest): Promise<DeviceView> {
		const { accountId } = claims;
		const userId = request.userId ?? claims.userId;

		if (userId !== claims.userId && !(await this.#may(claims, 'devices.assign'))) {
			throw new AppError('FORBIDDEN', 'assigning a device to another user needs devices.assign');
		}

		const cidr = this.env.EXIT_NODE_TUNNEL_CIDR;
		const [node, taken, takenSlots, entitlements, owner] = await Promise.all([
			this.#node(),
			this.devices.takenAddresses(),
			this.devices.takenSlots(accountId),
			this.entitlements.forAccount(accountId),
			this.users.findById(userId),
		]);

		if (!owner) throw new AppError('NOT_FOUND', 'no user with that id in this account');

		// The tunnel range is shared by every account, so without a per-account
		// ceiling one tenant can take all of it and every neighbour stops being
		// able to create a key. The ceiling is the plan, and what enforces it is
		// the unique index, not this count.
		const ceiling = entitlements.entitlements.seats * entitlements.entitlements.devicesPerUser;

		const claimed = new Set(takenSlots);

		// The slot is retried only when another request took it in between, which
		// is the race the index exists for. Running out of addresses is not a
		// reason to try the next slot: the range is shared, so it would be empty
		// for that one too.
		for (let attempt = 0; attempt < ceiling; attempt += 1) {
			const accountSlot = firstFreeSlot(ceiling, claimed);
			if (accountSlot === null) break;

			let lostTheSlot = false;

			for (const tunnelAddress of assignableAddresses(cidr, firstFreeAddress(cidr, taken))) {
				const created = await this.#claim({
					accountId,
					userId,
					name: request.name,
					publicKey: request.publicKey,
					tunnelAddress,
					accountSlot,
				});

				if (created === TAKEN_SLOT) {
					claimed.add(accountSlot);
					lostTheSlot = true;
					break;
				}

				if (created) {
					await this.outbox.enqueue(accountId, { kind: 'device.provision', deviceId: created.id });

					return { device: { ...toView({ ...created, userEmail: owner.email }), node } };
				}
			}

			if (!lostTheSlot) {
				throw new AppError('CONFLICT', 'the exit node tunnel range has no free address left');
			}
		}

		throw new AppError(
			'QUOTA_EXCEEDED',
			`the plan allows ${ceiling} live devices and the account already has that many`,
		);
	}

	async revoke(claims: AccessTokenClaims, deviceId: string): Promise<void> {
		const scope = await this.#scope(claims, 'devices.revokeAll');
		const revoked = await this.devices.revoke(deviceId, scope, this.clock.now());
		if (!revoked) throw new AppError('NOT_FOUND', 'no live device with that id');

		await this.outbox.enqueue(claims.accountId, {
			kind: 'device.revoke',
			publicKey: revoked.publicKey,
		});
	}

	async #scope(claims: AccessTokenClaims, permission: Permission): Promise<DeviceScope> {
		return (await this.#may(claims, permission))
			? { wholeAccount: true }
			: { ownedBy: claims.userId };
	}

	#may(claims: AccessTokenClaims, permission: Permission): Promise<boolean> {
		return this.permissions.has(claims.accountId, claims.userId, claims.role, permission);
	}

	async #claim(device: NewDevice): Promise<StoredDevice | undefined | typeof TAKEN_SLOT> {
		try {
			return await this.devices.claimAddress(device);
		} catch (error: unknown) {
			if (isUniqueViolation(error, LIVE_PUBLIC_KEY_INDEX)) {
				throw new AppError('CONFLICT', 'this public key already belongs to a live device');
			}

			// Somebody else took this seat between the hint and the insert. That
			// race is the reason the ceiling is an index and not a count.
			if (isUniqueViolation(error, LIVE_ACCOUNT_SLOT_INDEX)) return TAKEN_SLOT;

			throw error;
		}
	}

	async #node(): Promise<ExitNodeView> {
		const description = await this.directory.current();

		return {
			publicKey: description.publicKey,
			endpoint: description.endpoint,
			allowedIps: [...description.allowedIps],
		};
	}
}

function firstFreeSlot(ceiling: number, taken: ReadonlySet<number>): number | null {
	for (let slot = 0; slot < ceiling; slot += 1) {
		if (!taken.has(slot)) return slot;
	}

	return null;
}

function toView(device: OwnedDevice): Device {
	return {
		id: device.id,
		name: device.name,
		publicKey: device.publicKey,
		tunnelAddress: device.tunnelAddress,
		userId: device.userId,
		userEmail: device.userEmail,
		provisionedAt: device.provisionedAt?.toISOString() ?? null,
		createdAt: device.createdAt.toISOString(),
	};
}
