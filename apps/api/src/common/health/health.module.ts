import { Controller, Get, Inject, Module, type DynamicModule, type Provider } from '@nestjs/common';

import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';

import { HealthService } from './health.service.js';
import { HEALTH_INDICATORS, type HealthIndicator, type HealthReport } from './health.types.js';

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

export interface HealthModuleOptions {
	readonly readiness: readonly Provider<HealthIndicator>[];
}

@Module({})
export class HealthModule {
	static forRoot(options: HealthModuleOptions): DynamicModule {
		const tokens = options.readiness.map((provider) =>
			typeof provider === 'function' ? provider : (provider as { provide: symbol }).provide,
		);

		return {
			module: HealthModule,
			controllers: [HealthController],
			providers: [
				...options.readiness,
				{
					provide: HEALTH_INDICATORS,
					inject: tokens,
					useFactory: (...indicators: HealthIndicator[]) => indicators,
				},
				HealthService,
			],
		};
	}
}
