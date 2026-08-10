import { Logger } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '@vpn/testing/fakes';
import type { ExitNodeDescription, IExitNode, PeerSpec } from '@vpn/ports';

import { ExitNodeDirectory } from './exit-node-directory.service.js';

const FIRST_KEY = 'rKCjjZR5cgoZSG0BE1Cjs5wHcOAOYU5Vweb/Gj0rPWg=';
const REBUILT_KEY = 'hAcCPVXqcJRVvi/JIn1jjnpUAxbfEbAJPBUlkAcO8k4=';

class CountingNode implements IExitNode {
	calls = 0;
	publicKey = FIRST_KEY;
	failure: Error | null = null;

	describe(): Promise<ExitNodeDescription> {
		this.calls += 1;
		if (this.failure) return Promise.reject(this.failure);

		return Promise.resolve({
			publicKey: this.publicKey,
			endpoint: '127.0.0.1:21820',
			allowedIps: ['10.13.13.0/24'],
		});
	}

	provisionPeer(_peer: PeerSpec): Promise<void> {
		return Promise.resolve();
	}

	revokePeer(_publicKey: string): Promise<void> {
		return Promise.resolve();
	}

	listPeers(): Promise<readonly PeerSpec[]> {
		return Promise.resolve([]);
	}
}

function directory(clock = new FixedClock()) {
	const node = new CountingNode();
	return { node, clock, directory: new ExitNodeDirectory(node, clock) };
}

describe('ExitNodeDirectory', () => {
	it('asks the node once while the description is fresh', async () => {
		const { node, directory: subject } = directory();

		await subject.current();
		await subject.current();

		expect(node.calls).toBe(1);
	});

	it('serves one description to callers that arrive together', async () => {
		const { node, directory: subject } = directory();

		await Promise.all([subject.current(), subject.current(), subject.current()]);

		expect(node.calls).toBe(1);
	});

	it('asks the node again once the description has aged out', async () => {
		const { node, clock, directory: subject } = directory();

		await subject.current();
		clock.advance(61);
		await subject.current();

		expect(node.calls).toBe(2);
	});

	it('serves the key the rebuilt node reports, not the one it was started with', async () => {
		const { node, clock, directory: subject } = directory();

		await subject.current();
		node.publicKey = REBUILT_KEY;
		clock.advance(61);

		expect((await subject.current()).publicKey).toBe(REBUILT_KEY);
	});

	it('says so when the node comes back with a different public key', async () => {
		const reported = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		const { node, clock, directory: subject } = directory();

		await subject.current();
		node.publicKey = REBUILT_KEY;
		clock.advance(61);
		await subject.current();

		expect(reported).toHaveBeenCalledWith(
			expect.objectContaining({
				event: 'exit_node.public_key_changed',
				was: FIRST_KEY,
				now: REBUILT_KEY,
			}),
			expect.any(String),
		);

		reported.mockRestore();
	});

	it('stays quiet while the node keeps the key it had', async () => {
		const reported = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
		const { clock, directory: subject } = directory();

		await subject.current();
		clock.advance(61);
		await subject.current();

		expect(reported).not.toHaveBeenCalled();

		reported.mockRestore();
	});

	it('does not memoise a rejection', async () => {
		const { node, directory: subject } = directory();
		node.failure = new Error('the node is down');

		await expect(subject.current()).rejects.toThrow('the node is down');
		node.failure = null;

		expect((await subject.current()).publicKey).toBe(FIRST_KEY);
		expect(node.calls).toBe(2);
	});

	it('survives a node that is down at boot', async () => {
		const { node, directory: subject } = directory();
		node.failure = new Error('the node is down');

		subject.onApplicationBootstrap();
		await Promise.resolve();
		node.failure = null;

		expect((await subject.current()).publicKey).toBe(FIRST_KEY);
	});
});
