import { Module, type DynamicModule, type Provider } from '@nestjs/common';

import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { HEALTH_INDICATORS, type HealthIndicator } from './health.types.js';

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
