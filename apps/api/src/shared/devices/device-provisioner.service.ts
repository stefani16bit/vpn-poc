import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, EXIT_NODE, type IClock, type IExitNode } from '@vpn/ports';

import { DeviceRepository } from './device.repository.js';

@Injectable()
export class DeviceProvisioner {
	constructor(
		@Inject(EXIT_NODE) private readonly node: IExitNode,
		@Inject(CLOCK) private readonly clock: IClock,
		private readonly devices: DeviceRepository,
	) {}

	async provision(deviceId: string): Promise<void> {
		const device = await this.devices.findLiveById(deviceId);
		if (!device) return;

		await this.node.provisionPeer({
			publicKey: device.publicKey,
			tunnelAddress: device.tunnelAddress,
		});

		await this.devices.markProvisioned(device.id, this.clock.now());
	}

	async revoke(publicKey: string): Promise<void> {
		await this.node.revokePeer(publicKey);
	}
}
