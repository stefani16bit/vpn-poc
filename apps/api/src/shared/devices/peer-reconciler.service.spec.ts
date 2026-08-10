import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '@vpn/testing/fakes';
import { MemoryExitNode } from '@vpn/testing/fakes';
import type { Env } from '@vpn-poc/env';

import type { TransactionRunner } from '../database/transaction-runner.js';
import type { DeviceRepository, StoredDevice } from './device.repository.js';
import { PeerReconciler } from './peer-reconciler.service.js';

const CIDR = '10.13.13.0/24';
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

function live(peer: { publicKey: string; tunnelAddress: string }): StoredDevice {
	return {
		id: `device-${peer.tunnelAddress}`,
		accountId: 'account-1',
		userId: 'user-1',
		name: 'laptop',
		publicKey: peer.publicKey,
		tunnelAddress: peer.tunnelAddress,
		provisionedAt: new Date('2026-01-01T00:00:00.000Z'),
		revokedAt: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
	};
}

function reconciler(rows: readonly StoredDevice[] = []) {
	const node = new MemoryExitNode();
	const clock = new FixedClock();

	const markProvisioned = vi.fn(() => Promise.resolve());
	const devices = {
		listLiveAcrossAccounts: () => Promise.resolve(rows),
		markProvisioned,
	} as unknown as DeviceRepository;

	const transactions = {
		runAsSystem: <T>(work: () => Promise<T>) => work(),
	} as unknown as TransactionRunner;

	const subject = new PeerReconciler(node, devices, transactions, clock, {
		EXIT_NODE_TUNNEL_CIDR: CIDR,
	} as Env);

	return { subject, node, clock, markProvisioned };
}

describe('PeerReconciler', () => {
	it('revokes a peer no live device claims, which is what a deleted account leaves behind', async () => {
		const { subject, node } = reconciler();
		await node.provisionPeer(ADA);

		const report = await subject.runOnce();

		expect(await node.listPeers()).toEqual([]);
		expect(report).toMatchObject({ revoked: 1, provisioned: 0 });
	});

	it('leaves the devstack spike fixture alone, because it never allocated it', async () => {
		const { subject, node } = reconciler();
		await node.provisionPeer(SPIKE_FIXTURE);

		const report = await subject.runOnce();

		expect(await node.listPeers()).toEqual([SPIKE_FIXTURE]);
		expect(report).toMatchObject({ revoked: 0 });
	});

	it('keeps a peer that has a live device behind it', async () => {
		const { subject, node } = reconciler([live(ADA)]);
		await node.provisionPeer(ADA);

		await subject.runOnce();

		expect(await node.listPeers()).toEqual([ADA]);
	});

	it('provisions a live device the node has forgotten, which is a rebuilt node', async () => {
		const { subject, node, markProvisioned } = reconciler([live(ADA), live(GRACE)]);

		const report = await subject.runOnce();

		expect(await node.listPeers()).toEqual([ADA, GRACE]);
		expect(report).toMatchObject({ provisioned: 2 });
		expect(markProvisioned).not.toHaveBeenCalled();
	});

	it('reprovisions a peer whose address drifted from the row', async () => {
		const { subject, node } = reconciler([live(ADA)]);
		await node.provisionPeer({ ...ADA, tunnelAddress: '10.13.13.99/32' });

		await subject.runOnce();

		expect(await node.listPeers()).toEqual([ADA]);
	});

	it('does nothing on the next turn of the loop, because a sweep is not free', async () => {
		const { subject, node } = reconciler();
		await node.provisionPeer(ADA);
		await subject.runOnce();

		await node.provisionPeer(GRACE);
		const report = await subject.runOnce();

		expect(report).toBeNull();
		expect(await node.listPeers()).toEqual([GRACE]);
	});

	it('sweeps again once the interval has passed', async () => {
		const { subject, node, clock } = reconciler();
		await subject.runOnce();

		await node.provisionPeer(ADA);
		clock.advance(301);

		expect(await subject.runOnce()).toMatchObject({ revoked: 1 });
	});
});
