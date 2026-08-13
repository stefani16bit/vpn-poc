import type { Redis } from 'ioredis';

import type { CacheCounter, CacheKey, ICacheStore } from '@vpn/ports';
import { flattenCacheKey } from '@vpn/testing/fakes';

export class RedisCacheStore implements ICacheStore {
	readonly #redis: Redis;
	readonly #prefix: string;

	constructor(redis: Redis, prefix = 'poc-vpn') {
		this.#redis = redis;
		this.#prefix = prefix;
	}

	async get<T>(key: CacheKey): Promise<T | null> {
		const raw = await this.#redis.get(this.#key(key));
		if (raw === null) return null;

		try {
			return JSON.parse(raw) as T;
		} catch {
			await this.#redis.del(this.#key(key));
			return null;
		}
	}

	async set<T>(key: CacheKey, value: T, ttlSeconds: number): Promise<void> {
		await this.#redis.set(this.#key(key), JSON.stringify(value), 'EX', ttlSeconds);
	}

	async delete(key: CacheKey): Promise<void> {
		await this.#redis.del(this.#key(key));
	}

	async increment(key: CacheKey, ttlSeconds: number): Promise<CacheCounter> {
		const flat = this.#key(key);
		// The TTL is read in the same round trip that writes it. Asking for it
		// afterwards would be a second call against a counter another caller may
		// already have rolled over.
		const results = await this.#redis
			.multi()
			.incr(flat)
			.expire(flat, ttlSeconds, 'NX')
			.ttl(flat)
			.exec();

		const count = readReply(results, 0, 'INCR');
		const ttl = readReply(results, 2, 'TTL');

		// -1 is a key with no expiry and -2 is a key that vanished between the
		// INCR and the TTL. Neither is a wait a caller can be told to observe.
		return { count, ttlSeconds: ttl > 0 ? ttl : ttlSeconds };
	}

	#key(key: CacheKey): string {
		return `${this.#prefix}:${flattenCacheKey(key)}`;
	}
}

function readReply(
	results: [Error | null, unknown][] | null,
	index: number,
	command: string,
): number {
	const entry = results?.[index];
	if (!entry) throw new Error(`redis MULTI returned no result for ${command}`);

	const [error, value] = entry;
	if (error) throw error;

	return Number(value);
}
