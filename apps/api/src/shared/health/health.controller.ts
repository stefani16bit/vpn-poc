import { Controller, Get, Inject } from '@nestjs/common';

import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';

import { HealthService } from './health.service.js';
import type { HealthReport } from './health.types.js';

@Controller('health')
export class HealthController {
	constructor(
		private readonly health: HealthService,
		@Inject(ENV) private readonly env: Env,
	) {}

	@Get()
	live(): { status: 'ok'; version: string } {
		return { status: 'ok', version: this.env.APP_VERSION };
	}

	@Get('ready')
	ready(): Promise<HealthReport> {
		return this.health.readiness();
	}
}
