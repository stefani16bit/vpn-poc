import { describe, expect, it } from 'vitest';

import { describeExitNodeContract } from '@vpn/testing/contracts';

import { INTEGRATION } from '../integration.env.js';
import { HttpExitNode } from './HttpExitNode.js';

const options = {
	apiUrl: INTEGRATION.exitNodeApiUrl,
	endpoint: INTEGRATION.exitNodeEndpoint,
	allowedIps: [INTEGRATION.exitNodeTunnelCidr],
};

describeExitNodeContract('HttpExitNode', () => ({
	node: new HttpExitNode({ ...options, token: INTEGRATION.exitNodeApiToken }),
}));

describe('the exit node credential', () => {
	it('is refused by the node when it is absent', async () => {
		const response = await fetch(`${INTEGRATION.exitNodeApiUrl}/cgi-bin/describe`);

		expect(response.status).toBe(401);
	});

	it('is refused by the node when it is wrong', async () => {
		const node = new HttpExitNode({ ...options, token: 'w'.repeat(32) });

		await expect(node.describe()).rejects.toThrow(/401/);
	});

	it('does not let a wrong credential provision a peer either', async () => {
		const node = new HttpExitNode({ ...options, token: 'w'.repeat(32) });

		await expect(
			node.provisionPeer({
				publicKey: 'p3Kx4Vn5cGRLdiLuJmFCJKfM1WGmT+ZLQBw9y2sVJ2A=',
				tunnelAddress: '10.13.13.204/32',
			}),
		).rejects.toThrow(/401/);
	});
});
