import { Controller, Get, Inject, UseFilters } from '@nestjs/common';
import {
	HealthCheck,
	HealthCheckService,
	type HealthCheckResult,
	type HealthIndicatorFunction,
} from '@nestjs/terminus';

import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';

import { HealthCheckFilter } from './health-check.filter.js';
import { HEALTH_INDICATORS, type HealthIndicator } from './health.types.js';

function probe(indicator: HealthIndicator): HealthIndicatorFunction {
	return async () => {
		try {
			await indicator.check();
			return { [indicator.name]: { status: 'up' } };
		} catch {
			return { [indicator.name]: { status: 'down' } };
		}
	};
}

@Controller('health')
@UseFilters(HealthCheckFilter)
export class HealthController {
	constructor(
		private readonly health: HealthCheckService,
		@Inject(HEALTH_INDICATORS) private readonly indicators: readonly HealthIndicator[],
		@Inject(ENV) private readonly env: Env,
	) {}

	@Get()
	live(): { status: 'ok'; version: string } {
		return { status: 'ok', version: this.env.APP_VERSION };
	}

	@Get('ready')
	@HealthCheck()
	ready(): Promise<HealthCheckResult> {
		return this.health.check(this.indicators.map(probe));
	}
}
