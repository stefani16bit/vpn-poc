import { Inject, Injectable, Logger } from '@nestjs/common';

import { CLOCK, EXIT_NODE, type IClock, type IExitNode, type PeerSpec } from '@vpn/ports';
import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';

import { TransactionRunner } from '../database/transaction-runner.js';
import { DeviceRepository } from './device.repository.js';
import { isAssignable } from './tunnel-address.js';

const INTERVAL_SECONDS = 300;

export interface ReconcileReport {
	readonly revoked: number;
	readonly provisioned: number;
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

	async runOnce(): Promise<ReconcileReport | null> {
		if (!this.#due()) return null;
		this.#sweptAt = this.clock.now();

		const onNode = await this.node.listPeers();
		const live = await this.transactions.runAsSystem(() => this.devices.listLiveAcrossAccounts());

		const wanted = new Map(live.map((device) => [device.publicKey, device.tunnelAddress]));
		const ours = onNode.filter((peer) =>
			isAssignable(peer.tunnelAddress, this.env.EXIT_NODE_TUNNEL_CIDR),
		);

		const orphans = ours.filter((peer) => !wanted.has(peer.publicKey));
		const missing = [...wanted]
			.filter(([publicKey, tunnelAddress]) => !hasPeer(ours, publicKey, tunnelAddress))
			.map(([publicKey, tunnelAddress]) => ({ publicKey, tunnelAddress }));

		for (const peer of orphans) {
			await this.node.revokePeer(peer.publicKey);
		}

		for (const peer of missing) {
			await this.node.provisionPeer(peer);
		}

		const report = { revoked: orphans.length, provisioned: missing.length };
		if (report.revoked > 0 || report.provisioned > 0) {
			this.#logger.warn(
				{ event: 'exit_node.reconciled', ...report },
				'the exit node disagreed with the database and was corrected',
			);
		}

		return report;
	}

	#due(): boolean {
		if (!this.#sweptAt) return true;

		return this.clock.now().getTime() - this.#sweptAt.getTime() >= INTERVAL_SECONDS * 1000;
	}
}

function hasPeer(peers: readonly PeerSpec[], publicKey: string, tunnelAddress: string): boolean {
	return peers.some((peer) => peer.publicKey === publicKey && peer.tunnelAddress === tunnelAddress);
}
