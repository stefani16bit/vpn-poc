import { describe, expect, it, vi } from 'vitest';

import { FixedClock, MemoryCacheStore, MemorySecretStore } from '@vpn/testing/fakes';
import { ExitNodeCredentialError, ExitNodeFactory } from '@vpn-poc/adapters';

import type { TransactionRunner } from '../database/transaction-runner.js';
import type { FleetRepository, StoredExitNode } from '../fleet/fleet.repository.js';
import type { DeviceRepository, StoredDevice } from './device.repository.js';
import { PeerReconciler } from './peer-reconciler.service.js';

const CIDR = '10.13.13.0/24';
const NOW = new Date('2026-01-01T00:00:00.000Z');
const BEFORE_THE_GRACE = new Date('2025-12-31T23:55:00.000Z');
const INSIDE_THE_GRACE = new Date('2025-12-31T23:59:30.000Z');

const SAO_PAULO = 'node-sp';
const FRANKFURT = 'node-fra';

const SPIKE_FIXTURE = {
	publicKey: 'StZtsGF+hrd7nHOYtH0GhM/759qnBuUbKdVMEeFyLVU=',
	tunnelAddress: '10.13.13.2/32',
};
const ADA = {
	publicKey: 'hslPZ8OuAwL0RUaJPhxCw+XqWYgfm4ud70Y2FRzjaCM=',
	tunnelAddress: '10.13.13.4/32',
};
const GRACE = {
	publicKey: 'iNzK8AwMwfCghBcaNNdc8zgw63whVqeXAhRLUNg/gUk=',
	tunnelAddress: '10.13.13.5/32',
};

function nodeRow(id: string, tunnelCidr = CIDR): StoredExitNode {
	return {
		id,
		regionId: 'region-1',
		label: id,
		endpoint: '203.0.113.10:51820',
		controlUrl: 'http://203.0.113.10:51821',
		publicKey: `node-key-${id}`,
		tunnelCidr,
		credentialRef: 'poc-vpn/exit-node/test',
		lastSeenAt: NOW,
		createdAt: NOW,
	};
}

function live(
	peer: { publicKey: string; tunnelAddress: string },
	exitNodeId = SAO_PAULO,
): StoredDevice {
	return {
		id: `device-${exitNodeId}-${peer.tunnelAddress}`,
		accountId: 'account-1',
		userId: 'user-1',
		name: 'laptop',
		publicKey: peer.publicKey,
		tunnelAddress: peer.tunnelAddress,
		regionId: 'region-1',
		exitNodeId,
		provisionedAt: new Date('2026-01-01T00:00:00.000Z'),
		revokedAt: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
	};
}

function pending(
	peer: { publicKey: string; tunnelAddress: string },
	createdAt: Date,
	exitNodeId = SAO_PAULO,
): StoredDevice {
	return { ...live(peer, exitNodeId), provisionedAt: null, createdAt };
}

async function reconciler(rows: readonly StoredDevice[] = [], fleet = [nodeRow(SAO_PAULO)]) {
	const nodes = new ExitNodeFactory({
		driver: 'memory',
		secrets: new MemorySecretStore(),
		clock: new FixedClock(),
	});
	const clock = new FixedClock(NOW);

	const markProvisioned = vi.fn(() => Promise.resolve());
	const devices = {
		listLiveAcrossAccounts: () => Promise.resolve(rows),
		markProvisioned,
	} as unknown as DeviceRepository;

	const repository = {
		listAllNodes: () => Promise.resolve(fleet),
	} as unknown as FleetRepository;

	const transactions = {
		runAsSystem: <T>(work: () => Promise<T>) => work(),
	} as unknown as TransactionRunner;

	const cache = new MemoryCacheStore(clock);
	const build = () => new PeerReconciler(repository, nodes, devices, transactions, cache, clock);

	// A second process against the same cache is what two workers look like.
	return {
		subject: build(),
		twin: build(),
		nodes,
		node: await nodes.for(nodeRow(SAO_PAULO)),
		other: await nodes.for(nodeRow(FRANKFURT)),
		clock,
		markProvisioned,
	};
}

const BOTH = [nodeRow(SAO_PAULO), nodeRow(FRANKFURT)];

describe('PeerReconciler', () => {
	it('revokes a peer no live device claims, which is what a deleted account leaves behind', async () => {
		const { subject, node } = await reconciler();
		await node.provisionPeer(ADA);

		const report = await subject.runOnce();

		expect(await node.listPeers()).toEqual([]);
		expect(report).toMatchObject({ revoked: 1, provisioned: 0 });
	});

	it('leaves the devstack spike fixture alone, because it never allocated it', async () => {
		const { subject, node } = await reconciler();
		await node.provisionPeer(SPIKE_FIXTURE);

		const report = await subject.runOnce();

		expect(await node.listPeers()).toEqual([SPIKE_FIXTURE]);
		expect(report).toMatchObject({ revoked: 0 });
	});

	it('judges a peer by the range of the node it sits on, not by one range for the fleet', async () => {
		const fleet = [nodeRow(SAO_PAULO), nodeRow(FRANKFURT, '10.13.14.0/24')];
		const { subject, other } = await reconciler([], fleet);
		await other.provisionPeer({ ...ADA, tunnelAddress: '10.13.14.4/32' });

		const report = await subject.runOnce();

		expect(await other.listPeers()).toEqual([]);
		expect(report).toMatchObject({ revoked: 1 });
	});

	it('keeps a peer that has a live device behind it', async () => {
		const { subject, node } = await reconciler([live(ADA)]);
		await node.provisionPeer(ADA);

		await subject.runOnce();

		expect(await node.listPeers()).toEqual([ADA]);
	});

	it('provisions a live device the node has forgotten, which is a rebuilt node', async () => {
		const { subject, node, markProvisioned } = await reconciler([live(ADA), live(GRACE)]);

		const report = await subject.runOnce();

		expect(await node.listPeers()).toEqual([ADA, GRACE]);
		expect(report).toMatchObject({ provisioned: 2, stamped: 0 });
		expect(markProvisioned).not.toHaveBeenCalled();
	});

	it('reprovisions a peer whose address drifted from the row', async () => {
		const { subject, node } = await reconciler([live(ADA)]);
		await node.provisionPeer({ ...ADA, tunnelAddress: '10.13.13.99/32' });

		await subject.runOnce();

		expect(await node.listPeers()).toEqual([ADA]);
	});

	describe('a fleet of more than one', () => {
		it('compares each node with the devices assigned to it, and nobody else', async () => {
			const { subject, node, other } = await reconciler(
				[live(ADA, SAO_PAULO), live(GRACE, FRANKFURT)],
				BOTH,
			);

			await subject.runOnce();

			expect(await node.listPeers()).toEqual([ADA]);
			expect(await other.listPeers()).toEqual([GRACE]);
		});

		it('does not hand a node the peer of a device that lives on another one', async () => {
			const { subject, node, other } = await reconciler([live(ADA, FRANKFURT)], BOTH);
			await node.provisionPeer(ADA);

			const report = await subject.runOnce();

			expect(await node.listPeers()).toEqual([]);
			expect(await other.listPeers()).toEqual([ADA]);
			expect(report).toMatchObject({ revoked: 1, provisioned: 1 });
		});

		it('converges the others when one node refuses a peer', async () => {
			const { subject, node, other } = await reconciler(
				[live(ADA, SAO_PAULO), live(GRACE, FRANKFURT)],
				BOTH,
			);
			vi.spyOn(node, 'provisionPeer').mockRejectedValueOnce(new Error('wg set failed'));

			const report = await subject.runOnce();

			expect(await node.listPeers()).toEqual([]);
			expect(await other.listPeers()).toEqual([GRACE]);
			expect(report).toMatchObject({ provisioned: 1, failed: 1 });
		});
	});

	describe('a node that will not say what it is serving', () => {
		it('does not read silence as an empty node, which would revoke everything on it', async () => {
			const { subject, node } = await reconciler([live(ADA)]);
			await node.provisionPeer(ADA);
			const listPeers = vi
				.spyOn(node, 'listPeers')
				.mockRejectedValue(new Error('connect ECONNREFUSED'));

			const report = await subject.runOnce();

			listPeers.mockRestore();
			expect(await node.listPeers()).toEqual([ADA]);
			expect(report).toMatchObject({ revoked: 0, provisioned: 0, unreachable: 1 });
		});

		it('lets the rest of the fleet converge anyway', async () => {
			const { subject, node, other } = await reconciler(
				[live(ADA, SAO_PAULO), live(GRACE, FRANKFURT)],
				BOTH,
			);
			vi.spyOn(node, 'listPeers').mockRejectedValue(new Error('connect ECONNREFUSED'));

			const report = await subject.runOnce();

			expect(await other.listPeers()).toEqual([GRACE]);
			expect(report).toMatchObject({ provisioned: 1, unreachable: 1 });
		});

		// The credential is resolved when the node is opened, so opening can fail
		// now. It has to fail inside the per-node boundary: outside it, one node
		// whose secret is missing would abort the sweep for the whole fleet.
		it('counts a node whose credential will not resolve as unreachable, and sweeps the rest', async () => {
			const { subject, nodes, other } = await reconciler(
				[live(ADA, SAO_PAULO), live(GRACE, FRANKFURT)],
				BOTH,
			);
			const open = nodes.for.bind(nodes);
			vi.spyOn(nodes, 'for').mockImplementationOnce(() =>
				Promise.reject(new ExitNodeCredentialError('poc-vpn/exit-node/test')),
			);
			vi.spyOn(nodes, 'for').mockImplementation(open);

			const report = await subject.runOnce();

			expect(report).toMatchObject({ unreachable: 1, provisioned: 1 });
			expect(await other.listPeers()).toEqual([GRACE]);
		});

		it('stamps nobody on it, because a row it could not read is a row it did not converge', async () => {
			const { subject, node, markProvisioned } = await reconciler([pending(ADA, BEFORE_THE_GRACE)]);
			vi.spyOn(node, 'listPeers').mockRejectedValue(new Error('connect ECONNREFUSED'));

			const report = await subject.runOnce();

			expect(report).toMatchObject({ stamped: 0, unreachable: 1 });
			expect(markProvisioned).not.toHaveBeenCalled();
		});
	});

	describe('a device the queue never provisioned', () => {
		it('lands the peer and stamps the row, because the DLQ never will', async () => {
			const device = pending(ADA, BEFORE_THE_GRACE);
			const { subject, node, markProvisioned } = await reconciler([device]);

			const report = await subject.runOnce();

			expect(await node.listPeers()).toEqual([ADA]);
			expect(report).toMatchObject({ provisioned: 1, stamped: 1 });
			expect(markProvisioned).toHaveBeenCalledWith(device.id, NOW);
		});

		it('stamps a row whose peer the node already serves, which is a job that died after wg set', async () => {
			const device = pending(ADA, BEFORE_THE_GRACE);
			const { subject, node, markProvisioned } = await reconciler([device]);
			await node.provisionPeer(ADA);

			const report = await subject.runOnce();

			expect(report).toMatchObject({ provisioned: 0, stamped: 1 });
			expect(markProvisioned).toHaveBeenCalledWith(device.id, NOW);
		});

		it('is left alone inside the grace, so the sweep does not race a job still in flight', async () => {
			const { subject, node, markProvisioned } = await reconciler([pending(ADA, INSIDE_THE_GRACE)]);

			const report = await subject.runOnce();

			expect(await node.listPeers()).toEqual([]);
			expect(report).toMatchObject({ provisioned: 0, stamped: 0 });
			expect(markProvisioned).not.toHaveBeenCalled();
		});

		it('keeps the peer a job just landed, even inside the grace, so it is never mistaken for an orphan', async () => {
			const { subject, node } = await reconciler([pending(ADA, INSIDE_THE_GRACE)]);
			await node.provisionPeer(ADA);

			const report = await subject.runOnce();

			expect(await node.listPeers()).toEqual([ADA]);
			expect(report).toMatchObject({ revoked: 0, stamped: 0 });
		});

		it('is stamped once the grace passes, without the row having to change', async () => {
			const { subject, clock, markProvisioned } = await reconciler([pending(ADA, NOW)]);

			expect(await subject.runOnce()).toMatchObject({ stamped: 0 });

			clock.advance(121);

			expect(await subject.runOnce()).toMatchObject({ stamped: 1 });
			expect(markProvisioned).toHaveBeenCalledTimes(1);
		});
	});

	describe('the interval belongs to the loop', () => {
		it('does nothing on the next turn of the loop, because a sweep is not free', async () => {
			const { subject, node } = await reconciler();
			await node.provisionPeer(ADA);
			await subject.runIfDue();

			await node.provisionPeer(GRACE);
			const report = await subject.runIfDue();

			expect(report).toBeNull();
			expect(await node.listPeers()).toEqual([GRACE]);
		});

		it('sweeps again once the interval has passed', async () => {
			const { subject, node, clock } = await reconciler();
			await subject.runIfDue();

			await node.provisionPeer(ADA);
			clock.advance(301);

			expect(await subject.runIfDue()).toMatchObject({ revoked: 1 });
		});

		it('sweeps every time it is asked directly, so a caller that means now gets now', async () => {
			const { subject, node } = await reconciler();
			await subject.runOnce();

			await node.provisionPeer(ADA);

			expect(await subject.runOnce()).toMatchObject({ revoked: 1 });
		});

		// The throttle used to be a field on the instance, which only ever
		// throttled the process holding it.
		it('lets one of two workers sweep, not both', async () => {
			const { subject, twin } = await reconciler();

			const mine = await subject.runIfDue();
			const theirs = await twin.runIfDue();

			expect(mine).not.toBeNull();
			expect(theirs).toBeNull();
		});

		it('hands the window to the other worker once it has elapsed', async () => {
			const { subject, twin, clock, node } = await reconciler();
			await subject.runIfDue();

			await node.provisionPeer(ADA);
			clock.advance(301);

			expect(await twin.runIfDue()).toMatchObject({ revoked: 1 });
		});
	});

	describe('a node that refuses one peer', () => {
		it('keeps going through the rest instead of abandoning the sweep', async () => {
			const { subject, node } = await reconciler([live(ADA), live(GRACE)]);
			vi.spyOn(node, 'provisionPeer').mockRejectedValueOnce(new Error('wg set failed'));

			const report = await subject.runOnce();

			expect(report).toMatchObject({ provisioned: 1, failed: 1 });
			expect(await node.listPeers()).toHaveLength(1);
		});

		it('stamps the row whose peer it did write, in a sweep that also lost one', async () => {
			const { subject, node, markProvisioned } = await reconciler([
				pending(ADA, BEFORE_THE_GRACE),
				pending(GRACE, BEFORE_THE_GRACE),
			]);
			vi.spyOn(node, 'provisionPeer').mockRejectedValueOnce(new Error('wg set failed'));

			const report = await subject.runOnce();

			expect(report).toMatchObject({ provisioned: 1, stamped: 1, failed: 1 });
			expect(markProvisioned).toHaveBeenCalledTimes(1);
		});

		it('counts what it did, not what it set out to do', async () => {
			const { subject, node } = await reconciler();
			await node.provisionPeer(ADA);
			await node.provisionPeer(GRACE);
			vi.spyOn(node, 'revokePeer').mockRejectedValueOnce(new Error('wg set failed'));

			const report = await subject.runOnce();

			expect(report).toMatchObject({ revoked: 1, failed: 1 });
		});

		// Stamping a row whose peer the node refused would say the tunnel is open
		// when nothing was written to the node.
		it('stamps nobody whose peer it could not write', async () => {
			const { subject, node, markProvisioned } = await reconciler([pending(ADA, BEFORE_THE_GRACE)]);
			vi.spyOn(node, 'provisionPeer').mockRejectedValueOnce(new Error('wg set failed'));

			const report = await subject.runOnce();

			expect(report).toMatchObject({ provisioned: 0, stamped: 0, failed: 1 });
			expect(markProvisioned).not.toHaveBeenCalled();
		});

		it('reports nothing failed on a clean sweep', async () => {
			const { subject } = await reconciler([live(ADA)]);

			expect(await subject.runOnce()).toMatchObject({ failed: 0, unreachable: 0 });
		});
	});
});
