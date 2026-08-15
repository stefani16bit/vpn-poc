import type { IClock, ISecretStore, SecretVersions } from '@vpn/ports';

// Long enough that neither sweep pays for a resolution per node per run — the
// health one runs every 60s — and short enough that a rotated secret is picked
// up within one peer sweep.
const TTL_SECONDS = 300;

export interface CachingSecretStoreOptions {
	readonly inner: ISecretStore;
	readonly clock: IClock;
	readonly ttlSeconds?: number | undefined;
}

export class CachingSecretStore implements ISecretStore {
	readonly #inner: ISecretStore;
	readonly #clock: IClock;
	readonly #ttlSeconds: number;
	// Keyed by ref rather than by consumer: two nodes pointed at one secret
	// resolve once, and a row whose ref was edited misses immediately. In process
	// and never in ICacheStore — the shared cache is a place the secret would be
	// written to disk, which is what keeping it out of the row was for.
	readonly #entries = new Map<string, { versions: SecretVersions; expiresAt: number }>();

	constructor(options: CachingSecretStoreOptions) {
		this.#inner = options.inner;
		this.#clock = options.clock;
		this.#ttlSeconds = options.ttlSeconds ?? TTL_SECONDS;
	}

	async read(ref: string): Promise<SecretVersions | null> {
		const now = this.#clock.now().getTime();
		const cached = this.#entries.get(ref);
		if (cached && cached.expiresAt > now) return cached.versions;

		const versions = await this.#inner.read(ref);
		// Absence is never cached: the fix is somebody creating the secret, and
		// that should take effect on the next read rather than in five minutes.
		if (!versions) return null;

		this.#entries.set(ref, { versions, expiresAt: now + this.#ttlSeconds * 1000 });

		return versions;
	}
}
