import { describe, expect, it, vi } from 'vitest';

import type { ICacheStore } from '@vpn/ports';
import { FixedClock, MemoryCacheStore } from '@vpn/testing/fakes';

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
