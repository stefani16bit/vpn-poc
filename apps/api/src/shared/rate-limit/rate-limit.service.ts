import { Inject, Injectable } from '@nestjs/common';

import { CACHE_STORE, type ICacheStore } from '@vpn/ports';

import { AppError } from '../errors/app-error.js';

export interface RateLimitRule {
	readonly namespace: string;
	readonly limit: number;
	readonly windowSeconds: number;
}

@Injectable()
export class RateLimitService {
	constructor(@Inject(CACHE_STORE) private readonly cache: ICacheStore) {}

	async consume(rule: RateLimitRule, subject: string): Promise<void> {
		const count = await this.cache.increment(
			{ owner: null, namespace: rule.namespace, id: subject.toLowerCase() },
			rule.windowSeconds,
		);

		if (count > rule.limit) {
			throw new AppError('RATE_LIMITED', 'too many attempts, try again later');
		}
	}
}
