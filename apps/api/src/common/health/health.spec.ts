import { describe, expect, it, vi } from 'vitest';

import { HealthService } from './health.service.js';
import type { HealthIndicator } from './health.types.js';

function indicator(name: string, outcome: 'ok' | 'fail'): HealthIndicator {
	return {
		name,
		check: outcome === 'ok' ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error(name)),
	};
}

describe('HealthService', () => {
	it('reports ok when every indicator passes', async () => {
		const service = new HealthService([indicator('database', 'ok'), indicator('cache', 'ok')]);

		await expect(service.readiness()).resolves.toEqual({
			status: 'ok',
			checks: { database: 'ok', cache: 'ok' },
		});
	});

	it('names the dependency that failed rather than failing wholesale', async () => {
		const service = new HealthService([indicator('database', 'ok'), indicator('cache', 'fail')]);

		await expect(service.readiness()).resolves.toEqual({
			status: 'degraded',
			checks: { database: 'ok', cache: 'failed' },
		});
	});

	it('does not let one failing indicator hide the others', async () => {
		const service = new HealthService([
			indicator('a', 'fail'),
			indicator('b', 'fail'),
			indicator('c', 'ok'),
		]);

		const report = await service.readiness();
		expect(report.checks).toEqual({ a: 'failed', b: 'failed', c: 'ok' });
	});

	it('reports ok with no indicators registered', async () => {
		await expect(new HealthService([]).readiness()).resolves.toEqual({ status: 'ok', checks: {} });
	});

	it('runs the indicators concurrently', async () => {
		const started: string[] = [];
		const slow = (name: string): HealthIndicator => ({
			name,
			check: async () => {
				started.push(name);
				await new Promise((resolve) => setTimeout(resolve, 10));
			},
		});

		await new HealthService([slow('a'), slow('b')]).readiness();
		expect(started).toEqual(['a', 'b']);
	});
});
