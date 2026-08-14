import { describe, expect, it, vi } from 'vitest';

import { FixedClock, MemorySecretStore } from '@vpn/testing/fakes';
import { ExitNodeFactory } from '@vpn-poc/adapters';

import type { FleetRepository, StoredExitNode } from '../fleet/fleet.repository.js';
import { DeviceProvisioner } from './device-provisioner.service.js';
import type { DeviceRepository, StoredDevice } from './device.repository.js';

const NOW = new Date('2026-08-13T12:00:00.000Z');
const SAO_PAULO = 'node-sp';
const FRANKFURT = 'node-fra';

const PEER = {
	publicKey: 'hslPZ8OuAwL0RUaJPhxCw+XqWYgfm4ud70Y2FRzjaCM=',
	tunnelAddress: '10.13.13.4/32',
};

function nodeRow(id: string): StoredExitNode {
	return {
		id,
		regionId: 'region-1',
		label: id,
		endpoint: '203.0.113.10:51820',
		controlUrl: `http://${id}:51821`,
		publicKey: `node-key-${id}`,
		tunnelCidr: '10.13.13.0/24',
		credentialRef: 'poc-vpn/exit-node/test',
		lastSeenAt: NOW,
		createdAt: NOW,
	};
}

function device(exitNodeId: string | null): StoredDevice {
	return {
		id: 'device-1',
		accountId: 'account-1',
		userId: 'user-1',
		name: 'laptop',
		publicKey: PEER.publicKey,
		tunnelAddress: PEER.tunnelAddress,
		regionId: 'region-1',
		exitNodeId,
		provisionedAt: null,
		revokedAt: null,
		createdAt: NOW,
	};
}

async function provisioner(live: StoredDevice | undefined, fleet = [nodeRow(SAO_PAULO)]) {
	const nodes = new ExitNodeFactory({
		driver: 'memory',
		secrets: new MemorySecretStore(),
		clock: new FixedClock(),
	});
	const markProvisioned = vi.fn(() => Promise.resolve());

	const devices = {
		findLiveById: () => Promise.resolve(live),
		markProvisioned,
	} as unknown as DeviceRepository;

	const repository = {
		findNode: (id: string) => Promise.resolve(fleet.find((row) => row.id === id)),
	} as unknown as FleetRepository;

	return {
		subject: new DeviceProvisioner(repository, nodes, new FixedClock(NOW), devices),
		saoPaulo: await nodes.for(nodeRow(SAO_PAULO)),
		frankfurt: await nodes.for(nodeRow(FRANKFURT)),
		markProvisioned,
	};
}

describe('DeviceProvisioner', () => {
	it('writes the peer on the node the device was placed on', async () => {
		const { subject, saoPaulo, frankfurt, markProvisioned } = await provisioner(device(SAO_PAULO), [
			nodeRow(SAO_PAULO),
			nodeRow(FRANKFURT),
		]);

		await subject.provision('device-1');

		expect(await saoPaulo.listPeers()).toEqual([PEER]);
		expect(await frankfurt.listPeers()).toEqual([]);
		expect(markProvisioned).toHaveBeenCalledWith('device-1', NOW);
	});

	it('does nothing for a device that stopped being live before the job arrived', async () => {
		const { subject, saoPaulo, markProvisioned } = await provisioner(undefined);

		await subject.provision('device-1');

		expect(await saoPaulo.listPeers()).toEqual([]);
		expect(markProvisioned).not.toHaveBeenCalled();
	});

	// Reaching this means the placement constraint was dropped, and stamping a
	// row we never wrote to a node would say the tunnel is open.
	it('refuses to stamp a device whose node does not exist', async () => {
		const { subject, markProvisioned } = await provisioner(device('node-gone'));

		await expect(subject.provision('device-1')).rejects.toThrow('node-gone');
		expect(markProvisioned).not.toHaveBeenCalled();
	});

	it('takes the peer off the node the intent names, and off no other', async () => {
		const { subject, saoPaulo, frankfurt } = await provisioner(undefined, [
			nodeRow(SAO_PAULO),
			nodeRow(FRANKFURT),
		]);
		await saoPaulo.provisionPeer(PEER);
		await frankfurt.provisionPeer(PEER);

		await subject.revoke(PEER.publicKey, SAO_PAULO);

		expect(await saoPaulo.listPeers()).toEqual([]);
		expect(await frankfurt.listPeers()).toEqual([PEER]);
	});

	// The node was deregistered between the revocation and the delivery. There is
	// no machine left to tell, and the sweep has nothing to converge either.
	it('lets a revocation pass when the node is already gone', async () => {
		const { subject } = await provisioner(undefined);

		await expect(subject.revoke(PEER.publicKey, 'node-gone')).resolves.toBeUndefined();
	});
});
