import { Inject, Injectable, Logger } from '@nestjs/common';

import {
	CACHE_STORE,
	CLOCK,
	type ICacheStore,
	type IClock,
	type IExitNode,
	type PeerSpec,
} from '@vpn/ports';
import { ExitNodeFactory } from '@vpn-poc/adapters';

import { TransactionRunner } from '../database/transaction-runner.js';
import { FleetRepository, type StoredExitNode } from '../fleet/fleet.repository.js';
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
	readonly unreachable: number;
}

interface NodeOutcome {
	readonly revoked: number;
	readonly provisioned: number;
	readonly failed: number;
	readonly toStamp: readonly StoredDevice[];
}

@Injectable()
export class PeerReconciler {
	readonly #logger = new Logger(PeerReconciler.name);

	constructor(
		private readonly fleet: FleetRepository,
		private readonly nodes: ExitNodeFactory,
		private readonly devices: DeviceRepository,
		private readonly transactions: TransactionRunner,
		@Inject(CACHE_STORE) private readonly cache: ICacheStore,
		@Inject(CLOCK) private readonly clock: IClock,
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
		const { fleet, live } = await this.transactions.runAsSystem(async () => ({
			fleet: await this.fleet.listAllNodes(),
			live: await this.devices.listLiveAcrossAccounts(),
		}));

		const assigned = groupByNode(live);
		const toStamp: StoredDevice[] = [];
		let revoked = 0;
		let provisioned = 0;
		let failed = 0;
		let unreachable = 0;

		for (const row of fleet) {
			const outcome = await this.#sweep(row, assigned.get(row.id) ?? [], at);

			if (!outcome) {
				unreachable += 1;
				continue;
			}

			revoked += outcome.revoked;
			provisioned += outcome.provisioned;
			failed += outcome.failed;
			toStamp.push(...outcome.toStamp);
		}

		if (toStamp.length > 0) {
			await this.transactions.runAsSystem(async () => {
				for (const device of toStamp) {
					await this.devices.markProvisioned(device.id, at);
				}
			});
		}

		const report = { revoked, provisioned, stamped: toStamp.length, failed, unreachable };

		if (report.failed > 0 || report.unreachable > 0) {
			this.#logger.error(
				{ event: 'exit_node.sweep_incomplete', ...report },
				'part of the fleet was not converged; the next sweep retries what is left',
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

	// Null is "this node said nothing", and it is not the same answer as "this
	// node serves no peers". Reading silence as an empty list would revoke every
	// device on a machine that is merely unreachable.
	async #sweep(
		row: StoredExitNode,
		assigned: readonly StoredDevice[],
		at: Date,
	): Promise<NodeOutcome | null> {
		// Both inside the try, and that is the whole point of this boundary: opening
		// the node resolves its credential, so it can fail now. Outside, one node
		// whose secret is missing would abort the sweep of the entire fleet — the
		// isolation this method exists for, lost one level up.
		let node: IExitNode;
		let onNode: readonly PeerSpec[];
		try {
			node = await this.nodes.for(row);
			onNode = await node.listPeers();
		} catch (error) {
			this.#logger.error(
				{ event: 'exit_node.unreadable', nodeId: row.id, error },
				'the exit node did not report its peers, so nothing on it was touched',
			);

			return null;
		}

		const wanted = new Set(assigned.map((device) => device.publicKey));
		// Only the range this node hands out: a peer somebody seeded by hand is
		// not ours to revoke, and the range belongs to the node rather than to
		// the installation.
		const ours = onNode.filter((peer) => isAssignable(peer.tunnelAddress, row.tunnelCidr));

		const orphans = ours.filter((peer) => !wanted.has(peer.publicKey));
		const adoptable = assigned.filter((device) => !this.#stillWaitingOnAJob(device, at));
		const missing = adoptable
			.filter((device) => !hasPeer(ours, device.publicKey, device.tunnelAddress))
			.map((device) => ({ publicKey: device.publicKey, tunnelAddress: device.tunnelAddress }));
		const unstamped = adoptable.filter((device) => !device.provisionedAt);

		// Every call to the node is isolated: one peer the node refuses used to
		// abort the sweep, so nothing after it ran and nothing was stamped. The
		// next sweep converged anyway, which is why this cost latency rather than
		// correctness — but the report claimed a total it had not reached.
		const revoked = await this.#each(orphans, (peer) => node.revokePeer(peer.publicKey));
		const provisioned = await this.#each(missing, (peer) => node.provisionPeer(peer));

		const stamped = unstamped.filter((device) =>
			provisioned.done.some((peer) => peer.publicKey === device.publicKey),
		);
		const settled = unstamped.filter(
			(device) => !missing.some((peer) => peer.publicKey === device.publicKey),
		);

		return {
			revoked: revoked.done.length,
			provisioned: provisioned.done.length,
			failed: revoked.failed + provisioned.failed,
			toStamp: [...settled, ...stamped],
		};
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

function groupByNode(devices: readonly StoredDevice[]): Map<string, StoredDevice[]> {
	const byNode = new Map<string, StoredDevice[]>();

	for (const device of devices) {
		if (!device.exitNodeId) continue;

		const bucket = byNode.get(device.exitNodeId);
		if (bucket) bucket.push(device);
		else byNode.set(device.exitNodeId, [device]);
	}

	return byNode;
}

function hasPeer(peers: readonly PeerSpec[], publicKey: string, tunnelAddress: string): boolean {
	return peers.some((peer) => peer.publicKey === publicKey && peer.tunnelAddress === tunnelAddress);
}
