import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AdaptersModule, DATABASE } from '@vpn-poc/adapters';
import { CACHE_STORE, type ICacheStore } from '@vpn/ports';
import { loadEnv } from '@vpn-poc/env';

import { GlobalExceptionFilter } from './common/errors/exception.filter.js';
import { loggerConfig } from './common/http/logger.config.js';
import { HealthModule } from './common/health/health.module.js';
import {
	cacheIndicator,
	databaseIndicator,
	type QueryableDatabase,
} from './common/health/indicators.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BillingModule } from './modules/billing/billing.module.js';

@Module({
	imports: [
		LoggerModule.forRoot(
			loggerConfig({
				nodeEnv: loadEnv().NODE_ENV,
				level: loadEnv().LOG_LEVEL,
				version: loadEnv().APP_VERSION,
			}),
		),
		AdaptersModule,
		HealthModule.forRoot({
			readiness: [
				{
					provide: Symbol.for('vpn.health.database'),
					inject: [DATABASE],
					useFactory: (db: QueryableDatabase) => databaseIndicator(db),
				},
				{
					provide: Symbol.for('vpn.health.cache'),
					inject: [CACHE_STORE],
					useFactory: (cache: ICacheStore) => cacheIndicator(cache),
				},
			],
		}),
		AuthModule,
		BillingModule,
	],
	providers: [{ provide: APP_FILTER, useClass: GlobalExceptionFilter }],
})
export class AppModule {}
