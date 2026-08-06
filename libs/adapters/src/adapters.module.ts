import { Global, Inject, Module, type OnApplicationShutdown, type Provider } from '@nestjs/common';
import { Redis } from 'ioredis';
import { createTransport, type Transporter } from 'nodemailer';

import { createDatabase, type Database } from '@vpn-poc/database';
import { type Env, loadEnv } from '@vpn-poc/env';
import {
	BILLING_PROVIDER,
	CACHE_STORE,
	CLOCK,
	EMAIL_SENDER,
	ERROR_REPORTER,
	IDENTITY_PROVIDER,
	OBJECT_STORAGE,
	PASSWORD_HASHER,
	SMS_SENDER,
	type IBillingProvider,
	type ICacheStore,
	type IClock,
	type IEmailSender,
	type IErrorReporter,
	type IIdentityProvider,
	type IObjectStorage,
	type IPasswordHasher,
	type ISmsSender,
} from '@vpn/ports';
import {
	MemoryBillingProvider,
	MemoryCacheStore,
	MemoryEmailSender,
	MemoryObjectStorage,
	MemorySmsSender,
} from '@vpn/testing/fakes';

import { StripeBillingProvider } from './billing/StripeBillingProvider.js';
import { RedisCacheStore } from './cache/RedisCacheStore.js';
import { ScryptPasswordHasher } from './crypto/ScryptPasswordHasher.js';
import { SystemClock } from './crypto/SystemClock.js';
import { SmtpEmailSender } from './email/SmtpEmailSender.js';
import { DrizzleIdentityProvider } from './identity/DrizzleIdentityProvider.js';
import { NoopErrorReporter, SentryErrorReporter } from './observability/reporters.js';
import { defineAdapter, toProviders, tokensOf } from './registry.js';
import { ConsoleSmsSender } from './sms/ConsoleSmsSender.js';
import { S3ObjectStorage } from './storage/S3ObjectStorage.js';

export const ENV: unique symbol = Symbol.for('vpn.env');
export const DATABASE: unique symbol = Symbol.for('vpn.database');
export const DATABASE_CONNECTION: unique symbol = Symbol.for('vpn.database-connection');
export const REDIS: unique symbol = Symbol.for('vpn.redis');
export const SMTP_TRANSPORT: unique symbol = Symbol.for('vpn.smtp-transport');

type DatabaseConnection = ReturnType<typeof createDatabase>;

const infrastructure: Provider[] = [
	{ provide: ENV, useFactory: (): Env => loadEnv() },

	{
		provide: DATABASE_CONNECTION,
		inject: [ENV],
		useFactory: (env: Env) => createDatabase({ url: env.DATABASE_URL }),
	},
	{
		provide: DATABASE,
		inject: [DATABASE_CONNECTION],
		useFactory: (connection: DatabaseConnection): Database => connection.db,
	},

	{
		provide: REDIS,
		inject: [ENV],
		useFactory: (env: Env): Redis | null =>
			env.CACHE_DRIVER === 'redis' && env.REDIS_URL
				? new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, enableOfflineQueue: false })
				: null,
	},

	{
		provide: SMTP_TRANSPORT,
		inject: [ENV],
		useFactory: (env: Env): Transporter | null =>
			env.EMAIL_DRIVER === 'smtp' && env.SMTP_HOST && env.SMTP_PORT
				? createTransport({
						host: env.SMTP_HOST,
						port: env.SMTP_PORT,
						secure: env.SMTP_PORT === 465,
					})
				: null,
	},
];

export const ADAPTERS = [
	defineAdapter<IClock>({
		token: CLOCK,
		driver: () => 'system',
		drivers: { system: () => new SystemClock() },
	}),

	defineAdapter<IPasswordHasher>({
		token: PASSWORD_HASHER,
		driver: () => 'scrypt',
		drivers: { scrypt: () => new ScryptPasswordHasher() },
	}),

	defineAdapter<ICacheStore>({
		token: CACHE_STORE,
		driver: (env) => env.CACHE_DRIVER,
		inject: [REDIS, CLOCK],
		drivers: {
			redis: ({ resolve }) => new RedisCacheStore(resolve<Redis>(REDIS)),
			memory: ({ resolve }) => new MemoryCacheStore(resolve<IClock>(CLOCK)),
		},
	}),

	defineAdapter<IEmailSender>({
		token: EMAIL_SENDER,
		driver: (env) => env.EMAIL_DRIVER,
		inject: [SMTP_TRANSPORT, CACHE_STORE],
		drivers: {
			smtp: ({ env, resolve }) =>
				new SmtpEmailSender(
					resolve<Transporter>(SMTP_TRANSPORT),
					resolve<ICacheStore>(CACHE_STORE),
					{ from: env.EMAIL_FROM },
				),
			memory: () => new MemoryEmailSender(),
		},
	}),

	defineAdapter<ISmsSender>({
		token: SMS_SENDER,
		driver: (env) => env.SMS_DRIVER,
		inject: [CACHE_STORE],
		drivers: {
			console: ({ env, resolve }) =>
				new ConsoleSmsSender(resolve<ICacheStore>(CACHE_STORE), {
					nodeEnv: env.NODE_ENV,
					log: (message) => console.warn(message),
				}),
			memory: () => new MemorySmsSender(),
		},
	}),

	defineAdapter<IIdentityProvider>({
		token: IDENTITY_PROVIDER,
		driver: () => 'drizzle',
		inject: [DATABASE, PASSWORD_HASHER, CLOCK],
		drivers: {
			drizzle: ({ env, resolve }) =>
				new DrizzleIdentityProvider(
					resolve<Database>(DATABASE),
					resolve<IPasswordHasher>(PASSWORD_HASHER),
					resolve<IClock>(CLOCK),
					{ refreshTokenTtlSeconds: env.AUTH_REFRESH_TOKEN_TTL },
				),
		},
	}),

	defineAdapter<IBillingProvider>({
		token: BILLING_PROVIDER,
		driver: (env) => env.BILLING_DRIVER,
		inject: [CLOCK],
		drivers: {
			stripe: ({ env }) =>
				new StripeBillingProvider({
					apiKey: env.STRIPE_API_KEY ?? '',
					webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
					apiBase: env.STRIPE_API_BASE,
				}),
			memory: ({ resolve }) => new MemoryBillingProvider(resolve<IClock>(CLOCK)),
		},
	}),

	defineAdapter<IObjectStorage>({
		token: OBJECT_STORAGE,
		driver: (env) => env.STORAGE_DRIVER,
		drivers: {
			s3: ({ env }) =>
				new S3ObjectStorage({
					bucket: env.S3_BUCKET ?? '',
					region: env.AWS_REGION,
					endpoint: env.AWS_ENDPOINT_URL,
				}),
			memory: () => new MemoryObjectStorage(),
		},
	}),

	defineAdapter<IErrorReporter>({
		token: ERROR_REPORTER,
		driver: (env) => (env.SENTRY_DSN ? 'sentry' : 'noop'),
		drivers: {
			sentry: ({ env }) =>
				new SentryErrorReporter({
					dsn: env.SENTRY_DSN,
					environment: env.NODE_ENV,
					release: `poc-vpn-api@${env.APP_VERSION}`,
				}),
			noop: () => new NoopErrorReporter(),
		},
	}),
];

@Global()
@Module({
	providers: [...infrastructure, ...toProviders(ADAPTERS, ENV)],
	exports: [ENV, DATABASE, ...tokensOf(ADAPTERS)],
})
export class AdaptersModule implements OnApplicationShutdown {
	constructor(
		@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection,
		@Inject(REDIS) private readonly redis: Redis | null,
	) {}

	async onApplicationShutdown(): Promise<void> {
		await Promise.allSettled([this.connection.sql.end({ timeout: 5 }), this.redis?.quit()]);
	}
}
