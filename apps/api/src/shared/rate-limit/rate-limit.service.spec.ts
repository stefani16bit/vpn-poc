import { beforeEach, describe, expect, it } from 'vitest';

import { FixedClock, MemoryCacheStore } from '@vpn/testing/fakes';

import { AppError } from '../errors/app-error.js';
import { RateLimitService, type RateLimitRule } from './rate-limit.service.js';

const RULE: RateLimitRule = { namespace: 'rl:test', limit: 3, windowSeconds: 60 };

describe('RateLimitService', () => {
	let cache: MemoryCacheStore;
	let service: RateLimitService;

	beforeEach(() => {
		cache = new MemoryCacheStore(new FixedClock());
		service = new RateLimitService(cache);
	});

	it('lets the subject through up to the limit', async () => {
		for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
			await expect(service.consume(RULE, 'ada@example.com')).resolves.toBeUndefined();
		}
	});

	it('throws RATE_LIMITED on the attempt after the limit', async () => {
		for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
			await service.consume(RULE, 'ada@example.com');
		}

		try {
			await service.consume(RULE, 'ada@example.com');
			expect.unreachable('should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(AppError);
			expect((error as AppError).code).toBe('RATE_LIMITED');
		}
	});

	it('counts one bucket per subject', async () => {
		for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
			await service.consume(RULE, 'ada@example.com');
		}

		await expect(service.consume(RULE, 'grace@example.com')).resolves.toBeUndefined();
	});

	it('counts one bucket per rule', async () => {
		for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
			await service.consume(RULE, 'ada@example.com');
		}

		const other: RateLimitRule = { ...RULE, namespace: 'rl:other' };
		await expect(service.consume(other, 'ada@example.com')).resolves.toBeUndefined();
	});

	it('shares one bucket across the casings of a subject', async () => {
		for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
			await service.consume(RULE, 'Ada@Example.COM');
		}

		await expect(service.consume(RULE, 'ada@example.com')).rejects.toBeInstanceOf(AppError);
	});
});
