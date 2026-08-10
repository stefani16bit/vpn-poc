import { Inject, Injectable, Logger } from '@nestjs/common';

import { CLOCK, EXIT_NODE, type IClock, type IExitNode, type PeerSpec } from '@vpn/ports';
import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';

import { TransactionRunner } from '../database/transaction-runner.js';
import { DeviceRepository, type StoredDevice } from './device.repository.js';
import { isAssignable } from './tunnel-address.js';

const INTERVAL_SECONDS = 300;
// How long a row is allowed to say "not yet" before the sweep stops believing a
// job is still on its way to it.
const PENDING_GRACE_SECONDS = 120;

export interface ReconcileReport {
	readonly revoked: number;
	readonly provisioned: number;
	readonly stamped: number;
}

@Injectable()
export class PeerReconciler {
	readonly #logger = new Logger(PeerReconciler.name);
	#sweptAt: Date | null = null;

	constructor(
		@Inject(EXIT_NODE) private readonly node: IExitNode,
		private readonly devices: DeviceRepository,
		private readonly transactions: TransactionRunner,
		@Inject(CLOCK) private readonly clock: IClock,
		@Inject(ENV) private readonly env: Env,
	) {}

	async runIfDue(): Promise<ReconcileReport | null> {
		if (!this.#due()) return null;
		this.#sweptAt = this.clock.now();

		return this.runOnce();
	}

	async runOnce(): Promise<ReconcileReport> {
		const at = this.clock.now();
		const onNode = await this.node.listPeers();
		const live = await this.transactions.runAsSystem(() => this.devices.listLiveAcrossAccounts());

		const wanted = new Map(live.map((device) => [device.publicKey, device.tunnelAddress]));
		const ours = onNode.filter((peer) =>
			isAssignable(peer.tunnelAddress, this.env.EXIT_NODE_TUNNEL_CIDR),
		);

		const orphans = ours.filter((peer) => !wanted.has(peer.publicKey));
		const adoptable = live.filter((device) => !this.#stillWaitingOnAJob(device, at));
		const missing = adoptable
			.filter((device) => !hasPeer(ours, device.publicKey, device.tunnelAddress))
			.map((device) => ({ publicKey: device.publicKey, tunnelAddress: device.tunnelAddress }));
		const unstamped = adoptable.filter((device) => !device.provisionedAt);

		for (const peer of orphans) {
			await this.node.revokePeer(peer.publicKey);
		}

		for (const peer of missing) {
			await this.node.provisionPeer(peer);
		}

		if (unstamped.length > 0) {
			await this.transactions.runAsSystem(async () => {
				for (const device of unstamped) {
					await this.devices.markProvisioned(device.id, at);
				}
			});
		}

		const report = {
			revoked: orphans.length,
			provisioned: missing.length,
			stamped: unstamped.length,
		};

		if (report.revoked > 0 || report.provisioned > 0 || report.stamped > 0) {
			this.#logger.warn(
				{ event: 'exit_node.reconciled', ...report },
				'the exit node disagreed with the database and was corrected',
			);
		}

		return report;
	}

	#stillWaitingOnAJob(device: StoredDevice, at: Date): boolean {
		if (device.provisionedAt) return false;

		return at.getTime() - device.createdAt.getTime() < PENDING_GRACE_SECONDS * 1000;
	}

	#due(): boolean {
		if (!this.#sweptAt) return true;

		return this.clock.now().getTime() - this.#sweptAt.getTime() >= INTERVAL_SECONDS * 1000;
	}
}

function hasPeer(peers: readonly PeerSpec[], publicKey: string, tunnelAddress: string): boolean {
	return peers.some((peer) => peer.publicKey === publicKey && peer.tunnelAddress === tunnelAddress);
}
