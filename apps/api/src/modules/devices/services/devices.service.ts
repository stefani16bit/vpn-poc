import { Inject, Injectable } from '@nestjs/common';

import type { CreateDeviceRequest, Device, ExitNodeView } from '@vpn/contracts';
import { CLOCK, type IClock } from '@vpn/ports';
import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';

import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import { isUniqueViolation } from '../../../shared/database/pg-errors.js';
import {
	DeviceRepository,
	type NewDevice,
	type StoredDevice,
} from '../../../shared/devices/device.repository.js';
import { ExitNodeDirectory } from '../../../shared/devices/exit-node-directory.service.js';
import { assignableAddresses, firstFreeHost } from '../../../shared/devices/tunnel-address.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { OutboxRepository } from '../../../shared/outbox/outbox.repository.js';

const LIVE_PUBLIC_KEY_INDEX = 'devices_live_public_key_key';

export interface DeviceView {
	readonly device: Device;
	readonly node: ExitNodeView;
}

@Injectable()
export class DevicesService {
	constructor(
		private readonly devices: DeviceRepository,
		private readonly outbox: OutboxRepository,
		private readonly directory: ExitNodeDirectory,
		@Inject(CLOCK) private readonly clock: IClock,
		@Inject(ENV) private readonly env: Env,
	) {}

	async list(userId: string): Promise<{ devices: Device[]; node: ExitNodeView }> {
		const [stored, node] = await Promise.all([this.devices.listLive(userId), this.#node()]);

		return { devices: stored.map(toView), node };
	}

	async create(
		accountId: string,
		userId: string,
		request: CreateDeviceRequest,
	): Promise<DeviceView> {
		const cidr = this.env.EXIT_NODE_TUNNEL_CIDR;
		const [node, taken] = await Promise.all([this.#node(), this.devices.takenAddresses()]);

		for (const tunnelAddress of assignableAddresses(cidr, firstFreeHost(cidr, taken))) {
			const created = await this.#claim({
				accountId,
				userId,
				name: request.name,
				publicKey: request.publicKey,
				tunnelAddress,
			});

			if (created) {
				await this.outbox.enqueue(accountId, { kind: 'device.provision', deviceId: created.id });

				return { device: toView(created), node };
			}
		}

		throw new AppError('CONFLICT', 'the exit node tunnel range has no free address left');
	}

	async revoke(claims: AccessTokenClaims, deviceId: string): Promise<void> {
		const { accountId, userId } = claims;
		const revoked = await this.devices.revoke(deviceId, userId, this.clock.now());
		if (!revoked) throw new AppError('NOT_FOUND', 'no live device with that id');

		await this.outbox.enqueue(accountId, {
			kind: 'device.revoke',
			publicKey: revoked.publicKey,
		});
	}

	async #claim(device: NewDevice): Promise<StoredDevice | undefined> {
		try {
			return await this.devices.claimAddress(device);
		} catch (error: unknown) {
			if (isUniqueViolation(error, LIVE_PUBLIC_KEY_INDEX)) {
				throw new AppError('CONFLICT', 'this public key already belongs to a live device');
			}

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

function toView(device: StoredDevice): Device {
	return {
		id: device.id,
		name: device.name,
		publicKey: device.publicKey,
		tunnelAddress: device.tunnelAddress,
		provisionedAt: device.provisionedAt?.toISOString() ?? null,
		createdAt: device.createdAt.toISOString(),
	};
}
