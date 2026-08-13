import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AdaptersModule, DATABASE } from '@vpn-poc/adapters';
import { CACHE_STORE, type ICacheStore } from '@vpn/ports';
import { loadEnv } from '@vpn-poc/env';

import { MaintenanceModule } from './shared/maintenance/maintenance.module.js';
import { DatabaseModule } from './shared/database/database.module.js';
import { TenantTransactionInterceptor } from './shared/database/tenant-transaction.interceptor.js';
import { GlobalExceptionFilter } from './shared/errors/exception.filter.js';
import { loggerConfig } from './shared/http/logger.config.js';
import { HealthModule } from './shared/health/health.module.js';
import {
	cacheIndicator,
	databaseIndicator,
	type QueryableDatabase,
} from './shared/health/indicators.js';
import { NotificationsModule } from './shared/notifications/notifications.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { DevicesApiModule } from './modules/devices/devices.module.js';
import { UsersApiModule } from './modules/users/users.module.js';
import { EntitlementsApiModule } from './modules/entitlements/entitlements.module.js';
import { PermissionsApiModule } from './modules/permissions/permissions.module.js';

@Module({
	imports: [
		LoggerModule.forRoot(
			loggerConfig({
				nodeEnv: loadEnv().NODE_ENV,
				level: loadEnv().LOG_LEVEL,
				version: loadEnv().APP_VERSION,
				transport: loadEnv().LOG_TRANSPORT,
				transportUrl: loadEnv().LOG_TRANSPORT_URL,
			}),
		),
		AdaptersModule,
		DatabaseModule,
		MaintenanceModule,
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
		NotificationsModule,
		AuthModule,
		BillingModule,
		DevicesApiModule,
		UsersApiModule,
		PermissionsApiModule,
		EntitlementsApiModule,
	],
	providers: [
		{ provide: APP_FILTER, useClass: GlobalExceptionFilter },
		{ provide: APP_INTERCEPTOR, useClass: TenantTransactionInterceptor },
	],
})
export class AppModule {}
