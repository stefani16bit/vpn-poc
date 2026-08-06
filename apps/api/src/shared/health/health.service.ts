import { Inject, Injectable } from '@nestjs/common';

import { HEALTH_INDICATORS, type HealthIndicator, type HealthReport } from './health.types.js';

@Injectable()
export class HealthService {
	constructor(
		@Inject(HEALTH_INDICATORS) private readonly indicators: readonly HealthIndicator[],
	) {}

	async readiness(): Promise<HealthReport> {
		const results = await Promise.all(
			this.indicators.map(async (indicator) => {
				try {
					await indicator.check();
					return [indicator.name, 'ok'] as const;
				} catch {
					return [indicator.name, 'failed'] as const;
				}
			}),
		);

		const checks = Object.fromEntries(results);
		const status = results.every(([, value]) => value === 'ok') ? 'ok' : 'degraded';

		return { status, checks };
	}
}
