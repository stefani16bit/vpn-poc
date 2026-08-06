import { Inject, Injectable } from '@nestjs/common';

import { CACHE_STORE, type ICacheStore } from '@vpn/ports';

import { AppError } from '../../common/errors/app-error.js';

export interface RateLimitRule {
	readonly namespace: string;
	readonly limit: number;
	readonly windowSeconds: number;
}

export const RATE_LIMITS = {
	login: { namespace: 'rl:login', limit: 10, windowSeconds: 300 },
	register: { namespace: 'rl:register', limit: 5, windowSeconds: 3600 },
	forgotPassword: { namespace: 'rl:forgot', limit: 3, windowSeconds: 3600 },
	resendVerification: { namespace: 'rl:resend', limit: 3, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;

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
