import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type IClock, type IExitNode } from '@vpn/ports';
import { ExitNodeFactory } from '@vpn-poc/adapters';

import { AppError } from '../errors/app-error.js';
import { FleetRepository } from '../fleet/fleet.repository.js';
import { DeviceRepository } from './device.repository.js';

@Injectable()
export class DeviceProvisioner {
	constructor(
		private readonly fleet: FleetRepository,
		private readonly nodes: ExitNodeFactory,
		@Inject(CLOCK) private readonly clock: IClock,
		private readonly devices: DeviceRepository,
	) {}

	async provision(deviceId: string): Promise<void> {
		const device = await this.devices.findLiveById(deviceId);
		if (!device?.exitNodeId) return;

		const node = await this.#nodeFor(device.exitNodeId);

		await node.provisionPeer({
			publicKey: device.publicKey,
			tunnelAddress: device.tunnelAddress,
		});

		await this.devices.markProvisioned(device.id, this.clock.now());
	}

	// The node travels with the intent because the row is already gone by the
	// time this runs: revoking is what wrote the intent, and a revoked device is
	// exactly what the node removal is allowed to unhook from its node.
	async revoke(publicKey: string, exitNodeId: string): Promise<void> {
		const row = await this.fleet.findNode(exitNodeId);
		if (!row) return;

		await (await this.nodes.for(row)).revokePeer(publicKey);
	}

	async #nodeFor(exitNodeId: string): Promise<IExitNode> {
		const row = await this.fleet.findNode(exitNodeId);
		if (!row) throw new AppError('INTERNAL', `no exit node ${exitNodeId} to provision against`);

		return this.nodes.for(row);
	}
}
