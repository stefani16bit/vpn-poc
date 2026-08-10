import type { ExitNodeDescription, IExitNode, PeerSpec } from '@vpn/ports';

// What `wg show wg0 allowed-ips` prints for a peer that holds no address.
const NO_ALLOWED_IPS = '(none)';

// The node has no user directory; busybox httpd only enforces Basic, so the
// shared token is the password and the name is a constant on both sides.
const CONTROL_USER = 'worker';

export interface HttpExitNodeOptions {
	readonly apiUrl: string;
	readonly endpoint: string;
	readonly allowedIps: readonly string[];
	readonly token: string;
}

export class HttpExitNode implements IExitNode {
	readonly #apiUrl: string;
	readonly #endpoint: string;
	readonly #allowedIps: readonly string[];
	readonly #authorization: string;

	constructor(options: HttpExitNodeOptions) {
		if (!options.token) {
			throw new Error(
				'HttpExitNode refuses to talk to a node without a credential: set EXIT_NODE_API_TOKEN',
			);
		}

		this.#apiUrl = options.apiUrl.replace(/\/+$/, '');
		this.#endpoint = options.endpoint;
		this.#allowedIps = options.allowedIps;
		this.#authorization = `Basic ${Buffer.from(`${CONTROL_USER}:${options.token}`).toString('base64')}`;
	}

	async describe(): Promise<ExitNodeDescription> {
		const body = await this.#call('GET', '/cgi-bin/describe');
		const publicKey = body.match(/^publicKey=(.+)$/m)?.[1]?.trim();

		if (!publicKey) {
			throw new Error(`exit node did not report a public key: ${body.slice(0, 120)}`);
		}

		return { publicKey, endpoint: this.#endpoint, allowedIps: this.#allowedIps };
	}

	async provisionPeer(peer: PeerSpec): Promise<void> {
		await this.#call('POST', '/cgi-bin/peers', `${peer.publicKey}\n${peer.tunnelAddress}\n`);
	}

	async revokePeer(publicKey: string): Promise<void> {
		await this.#call('POST', '/cgi-bin/revoke', `${publicKey}\n`);
	}

	async listPeers(): Promise<readonly PeerSpec[]> {
		const body = await this.#call('GET', '/cgi-bin/peers');

		return body.split('\n').flatMap((line) => {
			const [publicKey, tunnelAddress] = line.trim().split(/\s+/);
			if (!publicKey || !tunnelAddress || tunnelAddress === NO_ALLOWED_IPS) return [];

			return [{ publicKey, tunnelAddress }];
		});
	}

	async #call(method: string, path: string, body?: string): Promise<string> {
		const response = await fetch(`${this.#apiUrl}${path}`, {
			method,
			headers: {
				authorization: this.#authorization,
				...(body === undefined ? {} : { 'content-type': 'text/plain' }),
			},
			...(body === undefined ? {} : { body }),
		});

		const text = await response.text();
		if (!response.ok) {
			throw new Error(`exit node refused ${method} ${path}: ${response.status} ${text.trim()}`);
		}

		return text;
	}
}
