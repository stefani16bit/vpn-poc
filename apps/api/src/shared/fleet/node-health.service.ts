import { Inject, Injectable, Logger } from '@nestjs/common';

import { CACHE_STORE, CLOCK, type ICacheStore, type IClock } from '@vpn/ports';
import { ExitNodeFactory } from '@vpn-poc/adapters';

import { TransactionRunner } from '../database/transaction-runner.js';
import { FleetRepository, type StoredExitNode } from './fleet.repository.js';

const INTERVAL_SECONDS = 60;

const SWEEP_CLAIM = { owner: null, namespace: 'exit-node:sweep', id: 'health' } as const;

export interface HealthReport {
	readonly checked: number;
	readonly reachable: number;
	readonly unreachable: number;
}

@Injectable()
export class NodeHealth {
	readonly #logger = new Logger(NodeHealth.name);

	constructor(
		private readonly fleet: FleetRepository,
		private readonly nodes: ExitNodeFactory,
		private readonly transactions: TransactionRunner,
		@Inject(CACHE_STORE) private readonly cache: ICacheStore,
		@Inject(CLOCK) private readonly clock: IClock,
	) {}

	async runIfDue(): Promise<HealthReport | null> {
		const claim = await this.cache.increment(SWEEP_CLAIM, INTERVAL_SECONDS);
		if (claim.count > 1) return null;

		return this.runOnce();
	}

	async runOnce(): Promise<HealthReport> {
		const rows = await this.transactions.runAsSystem(() => this.fleet.listAllNodes());

		let reachable = 0;

		for (const row of rows) {
			if (await this.#probe(row)) reachable += 1;
		}

		const report = {
			checked: rows.length,
			reachable,
			unreachable: rows.length - reachable,
		};

		if (report.unreachable > 0) {
			this.#logger.warn({ event: 'exit_node.unreachable', ...report }, 'some nodes are silent');
		}

		return report;
	}

	// Each node is probed on its own, because a fleet where one machine is down
	// must not look like a fleet that is down. Silence is never written as a
	// state: last_seen_at simply stops moving, and the reader decides how old is
	// too old.
	async #probe(row: StoredExitNode): Promise<boolean> {
		try {
			const described = await (await this.nodes.for(row)).describe();
			this.#reportRotation(row, described.publicKey);
			await this.transactions.runAsSystem(() => this.fleet.markSeen(row.id, this.clock.now()));

			return true;
		} catch (error) {
			this.#logger.warn(
				{ event: 'exit_node.probe_failed', nodeId: row.id, error },
				'the exit node control plane did not answer',
			);

			return false;
		}
	}

	// Reported here and not repaired: rewriting the row would quietly adopt a key
	// that every .conf already downloaded disagrees with. Reissuing in bulk is a
	// product decision, and the spec keeps it out of this delivery. DEC-068.
	#reportRotation(row: StoredExitNode, publicKey: string): void {
		if (row.publicKey === publicKey) return;

		this.#logger.error(
			{ event: 'exit_node.public_key_changed', nodeId: row.id, was: row.publicKey, now: publicKey },
			'the exit node reports a different public key: every .conf already downloaded for it is dead',
		);
	}
}
