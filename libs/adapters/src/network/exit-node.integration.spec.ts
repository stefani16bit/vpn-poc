import { describeExitNodeContract } from '@vpn/testing/contracts';

import { INTEGRATION } from '../integration.env.js';
import { HttpExitNode } from './HttpExitNode.js';

describeExitNodeContract('HttpExitNode', () => ({
	node: new HttpExitNode({
		apiUrl: INTEGRATION.exitNodeApiUrl,
		endpoint: INTEGRATION.exitNodeEndpoint,
		allowedIps: [INTEGRATION.exitNodeTunnelCidr],
	}),
}));
