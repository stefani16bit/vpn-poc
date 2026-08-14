import { describe, expect, it, vi } from 'vitest';

import { FixedClock, MemoryExitNode, MemorySecretStore } from '@vpn/testing/fakes';

import { clientAllowedIps, ExitNodeCredentialError, ExitNodeFactory } from './exit-node.factory.js';
import { HttpExitNode } from './HttpExitNode.js';

const SP = {
	id: 'node-sp',
	controlUrl: 'http://203.0.113.10:51821',
	endpoint: '203.0.113.10:51820',
	tunnelCidr: '10.13.13.0/24',
	credentialRef: 'poc-vpn/exit-node/sp',
};

const FRA = {
	id: 'node-fra',
	controlUrl: 'http://198.51.100.7:51821',
	endpoint: '198.51.100.7:51820',
	tunnelCidr: '10.14.14.0/24',
	credentialRef: 'poc-vpn/exit-node/fra',
};

const SEEDED = {
	'poc-vpn/exit-node/sp': 'the-sp-credential',
	'poc-vpn/exit-node/fra': 'the-fra-credential',
};

function factoryOn(driver: string, seed: Record<string, string> = SEEDED) {
	const secrets = new MemorySecretStore(seed);
	const clock = new FixedClock();

	return { factory: new ExitNodeFactory({ driver, secrets, clock }), secrets, clock };
}

describe('ExitNodeFactory on the http driver', () => {
	it('builds an adapter aimed at the row, not at the environment', async () => {
		const { factory } = factoryOn('http');

		await expect(factory.for(SP)).resolves.toBeInstanceOf(HttpExitNode);
	});

	it('gives two rows two adapters, because a fleet is not one node', async () => {
		const { factory } = factoryOn('http');

		expect(await factory.for(SP)).not.toBe(await factory.for(FRA));
	});

	// The point of the whole change: the credential comes from where the row says
	// it lives, so two nodes cannot end up sharing one.
	it('reads each row credential from the ref that row carries', async () => {
		const { factory, secrets } = factoryOn('http');
		const read = vi.spyOn(secrets, 'read');

		await factory.for(SP);
		await factory.for(FRA);

		expect(read.mock.calls.map(([ref]) => ref)).toEqual([
			'poc-vpn/exit-node/sp',
			'poc-vpn/exit-node/fra',
		]);
	});

	it('names the ref when nothing is stored at it, rather than dialling anonymously', async () => {
		const { factory } = factoryOn('http', {});

		await expect(factory.for(SP)).rejects.toBeInstanceOf(ExitNodeCredentialError);
		await expect(factory.for(SP)).rejects.toThrow('poc-vpn/exit-node/sp');
	});

	describe('the credential cache', () => {
		it('reads a ref once inside the window, so a sweep is not a call per node', async () => {
			const { factory, secrets } = factoryOn('http');
			const read = vi.spyOn(secrets, 'read');

			await factory.for(SP);
			await factory.for(SP);

			expect(read).toHaveBeenCalledTimes(1);
		});

		it('reads again once the window closes, which is how a rotation lands', async () => {
			const { factory, secrets, clock } = factoryOn('http');
			await factory.for(SP);
			secrets.seed(SP.credentialRef, 'the-rotated-one');

			clock.advance(301);
			const node = (await factory.for(SP)) as HttpExitNode;

			expect(JSON.stringify(node)).not.toContain('the-sp-credential');
		});

		// Caching the absence would make "create the secret" take five minutes to
		// take effect, which is exactly when the operator is watching.
		it('never caches a ref that resolved to nothing', async () => {
			const { factory, secrets } = factoryOn('http', {});
			const read = vi.spyOn(secrets, 'read');

			await expect(factory.for(SP)).rejects.toThrow();
			await expect(factory.for(SP)).rejects.toThrow();

			expect(read).toHaveBeenCalledTimes(2);
		});

		it('keeps two refs apart, or one node would answer with another credential', async () => {
			const { factory, secrets } = factoryOn('http');
			const read = vi.spyOn(secrets, 'read');

			await factory.for(SP);
			await factory.for(FRA);
			await factory.for(SP);

			expect(read).toHaveBeenCalledTimes(2);
		});
	});
});

describe('clientAllowedIps', () => {
	it('always routes the node own range, which is the one fact only the row knows', () => {
		expect(clientAllowedIps('10.14.14.0/24')).toEqual(['10.14.14.0/24']);
	});

	it('adds the operator routes instead of replacing the range', () => {
		expect(clientAllowedIps('10.14.14.0/24', '172.30.13.0/24, 172.16.0.0/12')).toEqual([
			'10.14.14.0/24',
			'172.30.13.0/24',
			'172.16.0.0/12',
		]);
	});

	it('does not list the node range twice when the operator repeats it', () => {
		expect(clientAllowedIps('10.13.13.0/24', '10.13.13.0/24,172.30.13.0/24')).toEqual([
			'10.13.13.0/24',
			'172.30.13.0/24',
		]);
	});

	// The shape that shipped enabled in .env.example, and the reason this is a
	// function: with an override, every node of a fleet handed out the same range.
	it('keeps two nodes on different ranges even when the operator set extra routes', () => {
		expect(clientAllowedIps('10.13.13.0/24', '172.30.13.0/24')).toEqual([
			'10.13.13.0/24',
			'172.30.13.0/24',
		]);
		expect(clientAllowedIps('10.14.14.0/24', '172.30.13.0/24')).toEqual([
			'10.14.14.0/24',
			'172.30.13.0/24',
		]);
	});
});

describe('ExitNodeFactory on the memory driver', () => {
	// No ref is resolved offline: there is no node to authenticate to, and making
	// the e2e seed secrets to exercise a fake would be a cost with no assertion.
	it('ignores the control url, because nothing is dialled offline', async () => {
		const { factory } = factoryOn('memory', {});

		await expect(factory.for(SP)).resolves.toBeInstanceOf(MemoryExitNode);
	});

	it('hands the same row the same instance, or a peer added would not be there next call', async () => {
		const { factory } = factoryOn('memory', {});
		const node = await factory.for(SP);
		await node.provisionPeer({ publicKey: 'k', tunnelAddress: '10.13.13.4/32' });

		expect(await (await factory.for(SP)).listPeers()).toHaveLength(1);
	});

	it('keeps two rows apart, so a peer on one node is not a peer on the other', async () => {
		const { factory } = factoryOn('memory', {});
		await (await factory.for(SP)).provisionPeer({ publicKey: 'k', tunnelAddress: '10.13.13.4/32' });

		expect(await (await factory.for(FRA)).listPeers()).toHaveLength(0);
	});
});
