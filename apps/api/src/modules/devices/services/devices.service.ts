import { Inject, Injectable } from '@nestjs/common';

import {
	STALE_AFTER_SECONDS,
	type CreateDeviceRequest,
	type Device,
	type DeviceAssigneeListResponse,
	type DeviceWithNode,
	type ExitNodeView,
	type Permission,
} from '@vpn/contracts';
import { CLOCK, type IClock } from '@vpn/ports';
import { clientAllowedIps, ENV } from '@vpn-poc/adapters';
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
import { FleetRepository, type PlacementNode } from '../../../shared/fleet/fleet.repository.js';
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
		private readonly fleet: FleetRepository,
		private readonly permissions: PermissionService,
		private readonly entitlements: EntitlementsService,
		@Inject(CLOCK) private readonly clock: IClock,
		@Inject(ENV) private readonly env: Env,
	) {}

	async list(claims: AccessTokenClaims): Promise<{ devices: DeviceWithNode[] }> {
		const [stored, nodes] = await Promise.all([
			this.devices.listLive(await this.#scope(claims, 'devices.readAll')),
			this.fleet.listNodes(),
		]);

		const byId = new Map(nodes.map((node) => [node.id, node]));

		return {
			devices: stored.map((device) => ({
				...toView(device),
				node: this.#viewOf(byId.get(device.exitNodeId ?? '')),
			})),
		};
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

		// The person chooses a region; which node serves it is ours. A region with
		// no node that answered recently is a dead end, and saying so here is what
		// keeps a .conf from being issued against a machine nobody can reach.
		const staleBefore = new Date(this.clock.now().getTime() - STALE_AFTER_SECONDS * 1000);
		const chosen = await this.fleet.pickNodeInRegion(request.regionId, staleBefore);

		if (!chosen) {
			throw new AppError('CONFLICT', 'no server in that region answered recently enough');
		}

		const cidr = chosen.tunnelCidr;
		const node = this.#viewOf(chosen);
		const [taken, takenSlots, entitlements, owner] = await Promise.all([
			this.devices.takenAddresses(chosen.id),
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
					regionId: request.regionId,
					exitNodeId: chosen.id,
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
			exitNodeId: placementOf(revoked.exitNodeId, revoked.id),
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

	// Built from the row, not from describe(): the row is the projection of the
	// node, and asking the machine on every request would put a network call in
	// front of a list that has to render.
	#viewOf(node: PlacementNode | undefined): ExitNodeView {
		if (!node) throw new AppError('INTERNAL', 'a live device points at no exit node');

		return {
			publicKey: node.publicKey,
			endpoint: node.endpoint,
			allowedIps: [...clientAllowedIps(node.tunnelCidr, this.env.EXIT_NODE_CLIENT_ALLOWED_IPS)],
		};
	}
}

// devices_live_has_placement makes this unreachable for a live row. Reaching it
// means the constraint was dropped, and answering with a device that has no node
// would hand somebody a .conf pointing nowhere.
function placementOf(value: string | null, deviceId: string): string {
	if (!value) throw new AppError('INTERNAL', `live device ${deviceId} has no placement`);

	return value;
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
		regionId: placementOf(device.regionId, device.id),
		exitNodeId: placementOf(device.exitNodeId, device.id),
		userId: device.userId,
		userEmail: device.userEmail,
		provisionedAt: device.provisionedAt?.toISOString() ?? null,
		createdAt: device.createdAt.toISOString(),
	};
}
