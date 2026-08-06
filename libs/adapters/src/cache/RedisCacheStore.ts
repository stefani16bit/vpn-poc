import type { Redis } from 'ioredis';

import type { CacheKey, ICacheStore } from '@vpn/ports';
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

	async increment(key: CacheKey, ttlSeconds: number): Promise<number> {
		const flat = this.#key(key);
		const results = await this.#redis.multi().incr(flat).expire(flat, ttlSeconds, 'NX').exec();

		const first = results?.[0];
		if (!first) throw new Error('redis MULTI returned no result for INCR');

		const [error, value] = first;
		if (error) throw error;
		return Number(value);
	}

	#key(key: CacheKey): string {
		return `${this.#prefix}:${flattenCacheKey(key)}`;
	}
}
