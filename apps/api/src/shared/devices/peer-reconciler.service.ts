import { Inject, Injectable, Logger } from '@nestjs/common';

import {
	CACHE_STORE,
	CLOCK,
	EXIT_NODE,
	type ICacheStore,
	type IClock,
	type IExitNode,
	type PeerSpec,
} from '@vpn/ports';
import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';

import { TransactionRunner } from '../database/transaction-runner.js';
import { DeviceRepository, type StoredDevice } from './device.repository.js';
import { isAssignable } from './tunnel-address.js';

const INTERVAL_SECONDS = 300;
// How long a row is allowed to say "not yet" before the sweep stops believing a
// job is still on its way to it.
const PENDING_GRACE_SECONDS = 120;

const SWEEP_CLAIM = { owner: null, namespace: 'exit-node:sweep', id: 'peers' } as const;

export interface ReconcileReport {
	readonly revoked: number;
	readonly provisioned: number;
	readonly stamped: number;
	readonly failed: number;
}

@Injectable()
export class PeerReconciler {
	readonly #logger = new Logger(PeerReconciler.name);

	constructor(
		@Inject(EXIT_NODE) private readonly node: IExitNode,
		private readonly devices: DeviceRepository,
		private readonly transactions: TransactionRunner,
		@Inject(CACHE_STORE) private readonly cache: ICacheStore,
		@Inject(CLOCK) private readonly clock: IClock,
		@Inject(ENV) private readonly env: Env,
	) {}

	// The claim is the counter itself: whoever takes it from 0 to 1 owns this
	// window, and the TTL re-arms it. A field on the instance only throttles the
	// process holding it, so a second worker would sweep the same node in
	// parallel with the first.
	async runIfDue(): Promise<ReconcileReport | null> {
		const claim = await this.cache.increment(SWEEP_CLAIM, INTERVAL_SECONDS);
		if (claim.count > 1) return null;

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

		// Every call to the node is isolated: one peer the node refuses used to
		// abort the sweep, so nothing after it ran and nothing was stamped. The
		// next sweep converged anyway, which is why this cost latency rather than
		// correctness — but the report claimed a total it had not reached.
		const revoked = await this.#each(orphans, (peer) => this.node.revokePeer(peer.publicKey));
		const provisioned = await this.#each(missing, (peer) => this.node.provisionPeer(peer));

		const stamped = unstamped.filter((device) =>
			provisioned.done.some((peer) => peer.publicKey === device.publicKey),
		);
		const settled = unstamped.filter(
			(device) => !missing.some((peer) => peer.publicKey === device.publicKey),
		);
		const toStamp = [...settled, ...stamped];

		if (toStamp.length > 0) {
			await this.transactions.runAsSystem(async () => {
				for (const device of toStamp) {
					await this.devices.markProvisioned(device.id, at);
				}
			});
		}

		const report = {
			revoked: revoked.done.length,
			provisioned: provisioned.done.length,
			stamped: toStamp.length,
			failed: revoked.failed + provisioned.failed,
		};

		if (report.failed > 0) {
			this.#logger.error(
				{ event: 'exit_node.sweep_incomplete', ...report },
				'the exit node refused part of the sweep; the next one retries what is left',
			);
		}

		if (report.revoked > 0 || report.provisioned > 0 || report.stamped > 0) {
			this.#logger.warn(
				{ event: 'exit_node.reconciled', ...report },
				'the exit node disagreed with the database and was corrected',
			);
		}

		return report;
	}

	async #each<T>(
		items: readonly T[],
		work: (item: T) => Promise<unknown>,
	): Promise<{ done: T[]; failed: number }> {
		const done: T[] = [];
		let failed = 0;

		for (const item of items) {
			try {
				await work(item);
				done.push(item);
			} catch (error) {
				failed += 1;
				this.#logger.warn({ event: 'exit_node.peer_failed', error }, 'a peer was refused');
			}
		}

		return { done, failed };
	}

	#stillWaitingOnAJob(device: StoredDevice, at: Date): boolean {
		if (device.provisionedAt) return false;

		return at.getTime() - device.createdAt.getTime() < PENDING_GRACE_SECONDS * 1000;
	}
}

function hasPeer(peers: readonly PeerSpec[], publicKey: string, tunnelAddress: string): boolean {
	return peers.some((peer) => peer.publicKey === publicKey && peer.tunnelAddress === tunnelAddress);
}
