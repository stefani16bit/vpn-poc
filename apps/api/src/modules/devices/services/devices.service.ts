import { Inject, Injectable } from '@nestjs/common';

import type { CreateDeviceRequest, Device, ExitNodeView } from '@vpn/contracts';
import { CLOCK, type IClock } from '@vpn/ports';
import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';

import { DeviceRepository, type StoredDevice } from '../../../shared/devices/device.repository.js';
import { ExitNodeDirectory } from '../../../shared/devices/exit-node-directory.service.js';
import { assignableAddresses } from '../../../shared/devices/tunnel-address.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { OutboxRepository } from '../../../shared/outbox/outbox.repository.js';

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
		const node = await this.#node();

		for (const tunnelAddress of assignableAddresses(this.env.EXIT_NODE_TUNNEL_CIDR)) {
			const created = await this.devices.claimAddress({
				accountId,
				userId,
				name: request.name,
				publicKey: request.publicKey,
				tunnelAddress,
			});

			if (!created) continue;

			await this.outbox.enqueue(accountId, { kind: 'device.provision', deviceId: created.id });

			return { device: toView(created), node };
		}

		throw new AppError('CONFLICT', 'the exit node tunnel range has no free address left');
	}

	async revoke(accountId: string, deviceId: string): Promise<void> {
		const revoked = await this.devices.revoke(deviceId, this.clock.now());
		if (!revoked) throw new AppError('NOT_FOUND', 'no live device with that id');

		await this.outbox.enqueue(accountId, {
			kind: 'device.revoke',
			publicKey: revoked.publicKey,
		});
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
