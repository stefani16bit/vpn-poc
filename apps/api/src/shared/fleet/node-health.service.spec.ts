import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryCacheStore } from '@vpn/testing/fakes';

import { NodeHealth } from './node-health.service.js';
import type { FleetRepository, StoredExitNode } from './fleet.repository.js';

const NOW = new Date('2026-08-13T12:00:00.000Z');

function nodeRow(id: string): StoredExitNode {
	return {
		id,
		regionId: 'region',
		label: id,
		endpoint: '203.0.113.10:51820',
		controlUrl: `http://${id}:51821`,
		publicKey: `pk-${id}`,
		tunnelCidr: '10.13.13.0/24',
		credentialRef: 'poc-vpn/exit-node/test',
		lastSeenAt: null,
		createdAt: NOW,
	};
}

function harness(
	rows: readonly StoredExitNode[],
	answers: Record<string, boolean>,
	reports: Record<string, string> = {},
) {
	const seen: string[] = [];

	const fleet = {
		listAllNodes: () => Promise.resolve(rows),
		markSeen: (id: string) => {
			seen.push(id);

			return Promise.resolve();
		},
	} as unknown as FleetRepository;

	const nodes = {
		for: (row: StoredExitNode) => ({
			describe: () =>
				answers[row.id]
					? Promise.resolve({
							publicKey: reports[row.id] ?? row.publicKey,
							endpoint: row.endpoint,
							allowedIps: [],
						})
					: Promise.reject(new Error('unreachable')),
		}),
	};

	const transactions = { runAsSystem: <T>(work: () => Promise<T>) => work() };
	const clock = { now: () => NOW };

	const service = new NodeHealth(
		fleet,
		nodes as never,
		transactions as never,
		new MemoryCacheStore(clock as never),
		clock as never,
	);

	return { service, seen };
}

describe('NodeHealth', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('stamps the node that answered', async () => {
		const { service, seen } = harness([nodeRow('sp')], { sp: true });

		const report = await service.runOnce();

		expect(seen).toEqual(['sp']);
		expect(report).toEqual({ checked: 1, reachable: 1, unreachable: 0 });
	});

	it('leaves a silent node unstamped instead of writing a state for it', async () => {
		const { service, seen } = harness([nodeRow('sp')], { sp: false });

		const report = await service.runOnce();

		expect(seen).toEqual([]);
		expect(report).toEqual({ checked: 1, reachable: 0, unreachable: 1 });
	});

	it('converges the fleet around one dead node, which is the whole point of probing per node', async () => {
		const rows = ['sp', 'fra', 'sin', 'jnb', 'iad'].map(nodeRow);
		const { service, seen } = harness(rows, {
			sp: true,
			fra: false,
			sin: true,
			jnb: true,
			iad: true,
		});

		const report = await service.runOnce();

		expect(seen).toEqual(['sp', 'sin', 'jnb', 'iad']);
		expect(report).toEqual({ checked: 5, reachable: 4, unreachable: 1 });
	});

	describe('a node that comes back with another key', () => {
		it('says so, because every .conf already downloaded for it is dead', async () => {
			const reported = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
			const { service } = harness([nodeRow('sp')], { sp: true }, { sp: 'pk-rebuilt' });

			await service.runOnce();

			expect(reported).toHaveBeenCalledWith(
				expect.objectContaining({
					event: 'exit_node.public_key_changed',
					nodeId: 'sp',
					was: 'pk-sp',
					now: 'pk-rebuilt',
				}),
				expect.any(String),
			);
		});

		it('stamps it anyway, because a rebuilt node is a node that answered', async () => {
			vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
			const { service, seen } = harness([nodeRow('sp')], { sp: true }, { sp: 'pk-rebuilt' });

			expect(await service.runOnce()).toEqual({ checked: 1, reachable: 1, unreachable: 0 });
			expect(seen).toEqual(['sp']);
		});

		it('stays quiet while the node keeps the key the row records', async () => {
			const reported = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
			const { service } = harness([nodeRow('sp')], { sp: true });

			await service.runOnce();

			expect(reported).not.toHaveBeenCalled();
		});
	});

	it('runs once per window, so two workers do not both sweep the fleet', async () => {
		const { service } = harness([nodeRow('sp')], { sp: true });

		expect(await service.runIfDue()).not.toBeNull();
		expect(await service.runIfDue()).toBeNull();
	});
});
