import type { IClock, IExitNode, ISecretStore } from '@vpn/ports';
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
	readonly clock: IClock;
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

// Long enough that neither sweep pays for a resolution per node per run — the
// health one runs every 60s — and short enough that a rotated secret is picked
// up within one peer sweep.
const CREDENTIAL_TTL_SECONDS = 300;

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
	readonly #clock: IClock;
	readonly #clientAllowedIps: string | undefined;
	readonly #offline = new Map<string, IExitNode>();
	// Keyed by ref rather than by node: two nodes pointed at one secret resolve
	// once, and a row whose ref was edited misses immediately. In process and
	// never in ICacheStore — the shared cache is a place the credential would be
	// written to disk, which is what keeping it out of the row was for.
	readonly #credentials = new Map<string, { value: string; expiresAt: number }>();

	constructor(options: ExitNodeFactoryOptions) {
		this.#driver = options.driver;
		this.#secrets = options.secrets;
		this.#clock = options.clock;
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

	async #credentialFor(ref: string): Promise<string> {
		const now = this.#clock.now().getTime();
		const cached = this.#credentials.get(ref);
		if (cached && cached.expiresAt > now) return cached.value;

		const value = await this.#secrets.read(ref);
		// A missing secret is never cached: the fix is somebody creating it, and
		// that should take effect on the next sweep rather than in five minutes.
		if (!value) throw new ExitNodeCredentialError(ref);

		this.#credentials.set(ref, { value, expiresAt: now + CREDENTIAL_TTL_SECONDS * 1000 });

		return value;
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
