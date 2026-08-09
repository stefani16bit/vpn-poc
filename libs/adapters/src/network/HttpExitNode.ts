import type { ExitNodeDescription, IExitNode, PeerSpec } from '@vpn/ports';

export interface HttpExitNodeOptions {
	readonly apiUrl: string;
	readonly endpoint: string;
	readonly allowedIps: readonly string[];
}

export class HttpExitNode implements IExitNode {
	readonly #apiUrl: string;
	readonly #endpoint: string;
	readonly #allowedIps: readonly string[];

	constructor(options: HttpExitNodeOptions) {
		this.#apiUrl = options.apiUrl.replace(/\/+$/, '');
		this.#endpoint = options.endpoint;
		this.#allowedIps = options.allowedIps;
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

	async listPeers(): Promise<readonly string[]> {
		const body = await this.#call('GET', '/cgi-bin/peers');
		return body
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
	}

	async #call(method: string, path: string, body?: string): Promise<string> {
		const response = await fetch(`${this.#apiUrl}${path}`, {
			method,
			...(body === undefined ? {} : { body, headers: { 'content-type': 'text/plain' } }),
		});

		const text = await response.text();
		if (!response.ok) {
			throw new Error(`exit node refused ${method} ${path}: ${response.status} ${text.trim()}`);
		}

		return text;
	}
}
