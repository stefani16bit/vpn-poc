import { Inject, Injectable } from '@nestjs/common';

import { CACHE_STORE, type CacheKey, type ICacheStore } from '@vpn/ports';

import { AppError } from '../errors/app-error.js';
import { currentIp, currentTenant } from '../http/request-context.js';

export interface RateLimitRule {
	readonly namespace: string;
	readonly limit: number;
	// Higher than `limit` on purpose: an office behind one address is many
	// people, and a shared address is not evidence of an attack.
	readonly ipLimit: number;
	readonly windowSeconds: number;
}

interface Verdict {
	readonly exceeded: boolean;
	readonly ttlSeconds: number;
}

@Injectable()
export class RateLimitService {
	constructor(@Inject(CACHE_STORE) private readonly cache: ICacheStore) {}

	async consume(rule: RateLimitRule, subject: string, tenant?: string): Promise<void> {
		const ip = currentIp();
		const owner = tenant ?? currentTenant();

		// Both buckets are consumed before either is judged. Throwing on the
		// first would leave the address counter behind: an attacker walking a
		// list would trip a fresh subject bucket every time and never advance the
		// one that is actually watching them.
		const bySubject = await this.#consume(
			{ owner, namespace: rule.namespace, id: subject.toLowerCase() },
			rule.limit,
			rule.windowSeconds,
		);

		const byIp = ip
			? await this.#consume(
					{ owner: null, namespace: `${rule.namespace}:ip`, id: ip },
					rule.ipLimit,
					rule.windowSeconds,
				)
			: { exceeded: false, ttlSeconds: 0 };

		const tripped = [bySubject, byIp].filter((verdict) => verdict.exceeded);
		if (tripped.length === 0) return;

		const retryAfterSeconds = Math.max(...tripped.map((verdict) => verdict.ttlSeconds));

		throw new AppError('RATE_LIMITED', 'too many attempts, try again later', undefined, {
			retryAfterSeconds,
		});
	}

	async #consume(key: CacheKey, limit: number, windowSeconds: number): Promise<Verdict> {
		const counter = await this.cache.increment(key, windowSeconds);

		return { exceeded: counter.count > limit, ttlSeconds: counter.ttlSeconds };
	}
}
