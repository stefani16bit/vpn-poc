import { describe, expect, it, vi } from 'vitest';

import type { ICacheStore } from '@vpn/ports';
import { FixedClock, MemoryCacheStore } from '@vpn/testing/fakes';

import { HealthController } from './health.controller.js';
import type { HealthService } from './health.service.js';
import { cacheIndicator, databaseIndicator, type QueryableDatabase } from './indicators.js';

describe('databaseIndicator', () => {
	it('is named after the dependency it probes', () => {
		expect(databaseIndicator({ execute: vi.fn() }).name).toBe('database');
	});

	it('probes with a statement the database can always answer', async () => {
		const execute = vi.fn().mockResolvedValue(undefined);

		await databaseIndicator({ execute } as QueryableDatabase).check();

		expect(execute).toHaveBeenCalledOnce();
	});

	it('surfaces the failure rather than swallowing it', async () => {
		const execute = vi.fn().mockRejectedValue(new Error('connection refused'));

		await expect(databaseIndicator({ execute } as QueryableDatabase).check()).rejects.toThrow(
			'connection refused',
		);
	});
});

describe('cacheIndicator', () => {
	it('is named after the dependency it probes', () => {
		expect(cacheIndicator(new MemoryCacheStore(new FixedClock())).name).toBe('cache');
	});

	it('round-trips a probe entry, so a write-only failure still counts', async () => {
		const cache = new MemoryCacheStore(new FixedClock());
		const get = vi.spyOn(cache, 'get');
		const set = vi.spyOn(cache, 'set');

		await cacheIndicator(cache).check();

		expect(set).toHaveBeenCalledOnce();
		expect(get).toHaveBeenCalledOnce();
	});

	it('surfaces a failing cache', async () => {
		const broken = {
			set: vi.fn().mockRejectedValue(new Error('redis is down')),
			get: vi.fn(),
		} as unknown as ICacheStore;

		await expect(cacheIndicator(broken).check()).rejects.toThrow('redis is down');
	});
});

describe('HealthController', () => {
	it('answers liveness without touching a dependency', () => {
		const health = { readiness: vi.fn() } as unknown as HealthService;
		const controller = new HealthController(health, { APP_VERSION: '1.2.3' } as never);

		expect(controller.live()).toEqual({ status: 'ok', version: '1.2.3' });
		expect(health.readiness).not.toHaveBeenCalled();
	});

	it('delegates readiness to the service', async () => {
		const report = { status: 'ok' as const, checks: [] };
		const health = { readiness: vi.fn().mockResolvedValue(report) } as unknown as HealthService;
		const controller = new HealthController(health, { APP_VERSION: '1.2.3' } as never);

		expect(await controller.ready()).toBe(report);
	});
});
