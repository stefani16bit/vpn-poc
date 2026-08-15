import type { IExitNode, ISecretStore } from '@vpn/ports';
import { MemoryExitNode } from '@vpn/testing/fakes';

import { HttpExitNode } from './HttpExitNode.js';

export interface ExitNodeRow {
	readonly id: string;
	readonly controlUrl: string;
	readonly endpoint: string;
	readonly tunnelCidr: string;
	readonly credentialRef: string;
}

export interface ExitNodeFactoryOptions {
	readonly driver: string;
	readonly secrets: ISecretStore;
	readonly clientAllowedIps?: string | undefined;
}

// Distinguishable from "the node refused me" on purpose: a ref nobody stored a
// secret at sends the operator to the secret store, and a 401 sends them to the
// node. One error for both sends half of them to the wrong place.
export class ExitNodeCredentialError extends Error {
	constructor(readonly ref: string) {
		super(`no secret is stored at ${ref}`);
		this.name = 'ExitNodeCredentialError';
	}
}

// What the client routes into the tunnel: the node's own range, plus whatever
// else the operator wants reachable through it. The extra routes are added, not
// substituted — a node's range is a fact about that node, and letting one
// environment variable replace it hands every node in a fleet the same range.
export function clientAllowedIps(
	tunnelCidr: string,
	extraRoutes?: string | undefined,
): readonly string[] {
	const extra = (extraRoutes ?? '')
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);

	return [tunnelCidr, ...extra.filter((entry) => entry !== tunnelCidr)];
}

export class ExitNodeFactory {
	readonly #driver: string;
	readonly #secrets: ISecretStore;
	readonly #clientAllowedIps: string | undefined;
	readonly #offline = new Map<string, IExitNode>();

	constructor(options: ExitNodeFactoryOptions) {
		this.#driver = options.driver;
		this.#secrets = options.secrets;
		this.#clientAllowedIps = options.clientAllowedIps;
	}

	async for(node: ExitNodeRow): Promise<IExitNode> {
		if (this.#driver === 'memory') return this.#memoryFor(node.id);

		return new HttpExitNode({
			apiUrl: node.controlUrl,
			token: await this.#credentialFor(node.credentialRef),
			endpoint: node.endpoint,
			allowedIps: this.#allowedIpsFor(node),
		});
	}

	// The current value only. The node accepts the previous one too during a
	// rotation window, but that window exists so the two sides can move in either
	// order — reaching for the retired half here would keep it alive past the
	// point where somebody deliberately stopped publishing it.
	async #credentialFor(ref: string): Promise<string> {
		const versions = await this.#secrets.read(ref);
		if (!versions) throw new ExitNodeCredentialError(ref);

		return versions.current;
	}

	#memoryFor(id: string): IExitNode {
		const existing = this.#offline.get(id);
		if (existing) return existing;

		const node = new MemoryExitNode();
		this.#offline.set(id, node);

		return node;
	}

	#allowedIpsFor(node: ExitNodeRow): readonly string[] {
		return clientAllowedIps(node.tunnelCidr, this.#clientAllowedIps);
	}
}
