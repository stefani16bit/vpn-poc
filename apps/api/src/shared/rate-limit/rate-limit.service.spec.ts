import { beforeEach, describe, expect, it } from 'vitest';

import { FixedClock, MemoryCacheStore } from '@vpn/testing/fakes';

import { AppError } from '../errors/app-error.js';
import { runWithContext, type RequestContext } from '../http/request-context.js';
import { RateLimitService, type RateLimitRule } from './rate-limit.service.js';

const RULE: RateLimitRule = { namespace: 'rl:test', limit: 3, ipLimit: 8, windowSeconds: 60 };

function context(overrides: Partial<RequestContext> = {}): RequestContext {
	return {
		correlationId: 'corr-1',
		locale: 'en',
		module: 'auth',
		ip: null,
		tenant: null,
		...overrides,
	};
}

function from(overrides: Partial<RequestContext>, work: () => Promise<void>): Promise<void> {
	return runWithContext(context(overrides), work);
}

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

	describe('telling the caller how long to wait', () => {
		it('carries the remaining window on the refusal', async () => {
			for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
				await service.consume(RULE, 'ada@example.com');
			}

			const error = await service.consume(RULE, 'ada@example.com').catch((thrown) => thrown);

			expect(error).toBeInstanceOf(AppError);
			expect((error as AppError).retryAfterSeconds).toBeGreaterThan(0);
			expect((error as AppError).retryAfterSeconds).toBeLessThanOrEqual(RULE.windowSeconds);
		});

		// The window shrinks as it elapses, and a caller told to wait the full
		// window every time waits longer than the rule ever asked for.
		it('reports what is left of the window, not the whole of it', async () => {
			const clock = new FixedClock();
			const shrinking = new RateLimitService(new MemoryCacheStore(clock));

			for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
				await shrinking.consume(RULE, 'ada@example.com');
			}
			clock.advance(40);

			const error = await shrinking.consume(RULE, 'ada@example.com').catch((thrown) => thrown);

			expect((error as AppError).retryAfterSeconds).toBeLessThanOrEqual(20);
		});
	});

	describe('the address behind the attempt', () => {
		it('refuses a caller walking a list of addresses, which no subject bucket sees', async () => {
			await from({ ip: '203.0.113.9' }, async () => {
				for (let attempt = 0; attempt < RULE.ipLimit; attempt += 1) {
					await service.consume(RULE, `victim-${attempt}@example.com`);
				}

				await expect(service.consume(RULE, 'one-more@example.com')).rejects.toBeInstanceOf(
					AppError,
				);
			});
		});

		it('leaves another address alone, because a bucket per address is the point', async () => {
			await from({ ip: '203.0.113.9' }, async () => {
				for (let attempt = 0; attempt < RULE.ipLimit; attempt += 1) {
					await service.consume(RULE, `victim-${attempt}@example.com`);
				}
			});

			await from({ ip: '198.51.100.4' }, async () => {
				await expect(service.consume(RULE, 'ada@example.com')).resolves.toBeUndefined();
			});
		});

		// Throwing on the subject bucket before touching the address bucket would
		// let somebody hammer one address, get refused, and leave the counter that
		// watches them standing still.
		it('advances the address bucket even on an attempt the subject bucket refused', async () => {
			await from({ ip: '203.0.113.9' }, async () => {
				for (let attempt = 0; attempt < RULE.ipLimit; attempt += 1) {
					await service.consume(RULE, 'ada@example.com').catch(() => undefined);
				}

				await expect(service.consume(RULE, 'fresh@example.com')).rejects.toBeInstanceOf(AppError);
			});
		});

		it('still limits the subject when the transport gave no address', async () => {
			for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
				await service.consume(RULE, 'ada@example.com');
			}

			await expect(service.consume(RULE, 'ada@example.com')).rejects.toBeInstanceOf(AppError);
		});
	});

	describe('one bucket per tenant', () => {
		it('does not let hammering one company lock the address out of another', async () => {
			for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
				await service.consume(RULE, 'ada@example.com', 'acme');
			}

			await expect(service.consume(RULE, 'ada@example.com', 'globex')).resolves.toBeUndefined();
		});

		it('takes the tenant from the host when the caller named none', async () => {
			await from({ tenant: 'acme' }, async () => {
				for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
					await service.consume(RULE, 'ada@example.com');
				}
			});

			await from({ tenant: 'globex' }, async () => {
				await expect(service.consume(RULE, 'ada@example.com')).resolves.toBeUndefined();
			});
		});

		it('prefers what the caller named over the host', async () => {
			await from({ tenant: 'acme' }, async () => {
				for (let attempt = 0; attempt < RULE.limit; attempt += 1) {
					await service.consume(RULE, 'ada@example.com', 'globex');
				}

				await expect(service.consume(RULE, 'ada@example.com')).resolves.toBeUndefined();
			});
		});
	});
});
