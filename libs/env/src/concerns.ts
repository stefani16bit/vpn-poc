import { z } from 'zod';

const portSchema = z.coerce.number().int().min(1).max(65535);
const secondsSchema = z.coerce.number().int().positive();

export const runtimeEnvSchema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	APP_VERSION: z.string().default('0.0.0'),
	API_PORT: portSchema.default(3000),
	WEB_ORIGIN: z.string().url(),
	LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
	LOG_TRANSPORT: z.enum(['pretty', 'json', 'file', 'gelf', 'loki']).optional(),
	LOG_TRANSPORT_URL: z.string().url().optional(),
});

export const databaseEnvSchema = z.object({
	DATABASE_URL: z.string().url(),
	DATABASE_MIGRATION_URL: z.string().url().optional(),
});

export const authEnvSchema = z.object({
	AUTH_JWT_SECRET: z.string().min(32, 'AUTH_JWT_SECRET must be at least 32 characters'),
	AUTH_ACCESS_TOKEN_TTL: secondsSchema.default(900),
	AUTH_REFRESH_TOKEN_TTL: secondsSchema.default(2_592_000),
	AUTH_PASSWORD_RESET_TTL: secondsSchema.default(3600),
	AUTH_EMAIL_VERIFICATION_TTL: secondsSchema.default(86_400),
});

export const cacheEnvSchema = z.object({
	CACHE_DRIVER: z.enum(['redis', 'memory']).default('memory'),
	REDIS_URL: z.string().url().optional(),
});

export const emailEnvSchema = z.object({
	EMAIL_DRIVER: z.enum(['smtp', 'memory']).default('memory'),
	SMTP_HOST: z.string().optional(),
	SMTP_PORT: portSchema.optional(),
	EMAIL_FROM: z.string().default('poc-vpn <no-reply@poc-vpn.local>'),
});

export const smsEnvSchema = z.object({
	SMS_DRIVER: z.enum(['console', 'memory']).default('console'),
});

export const billingEnvSchema = z.object({
	BILLING_DRIVER: z.enum(['stripe', 'memory']).default('memory'),
	STRIPE_API_KEY: z.string().optional(),
	STRIPE_API_BASE: z.string().url().optional(),
	STRIPE_WEBHOOK_SECRET: z.string().optional(),
	STRIPE_PRICE_ID: z.string().optional(),
	STRIPE_PRICE_ID_YEARLY: z.string().optional(),
});

export const storageEnvSchema = z.object({
	STORAGE_DRIVER: z.enum(['s3', 'memory']).default('memory'),
	AWS_REGION: z.string().default('us-east-1'),
	AWS_ENDPOINT_URL: z.string().url().optional(),
	S3_BUCKET: z.string().optional(),
});

export const queueEnvSchema = z.object({
	QUEUE_DRIVER: z.enum(['sqs', 'memory']).default('memory'),
	QUEUE_URL: z.string().url().optional(),
});

export const exitNodeEnvSchema = z.object({
	EXIT_NODE_DRIVER: z.enum(['http', 'memory']).default('memory'),
	EXIT_NODE_API_URL: z.string().url().optional(),
	EXIT_NODE_ENDPOINT: z.string().default('127.0.0.1:21820'),
	EXIT_NODE_TUNNEL_CIDR: z.string().default('10.13.13.0/24'),
	EXIT_NODE_CLIENT_ALLOWED_IPS: z.string().optional(),
});

export const observabilityEnvSchema = z.object({
	SENTRY_DSN: z.string().default(''),
});

export function assertDriverConfiguration(env: {
	CACHE_DRIVER: string;
	REDIS_URL?: string | undefined;
	EMAIL_DRIVER: string;
	SMTP_HOST?: string | undefined;
	SMTP_PORT?: number | undefined;
	BILLING_DRIVER: string;
	STRIPE_API_KEY?: string | undefined;
	STRIPE_API_BASE?: string | undefined;
	STRIPE_WEBHOOK_SECRET?: string | undefined;
	STRIPE_PRICE_ID?: string | undefined;
	STRIPE_PRICE_ID_YEARLY?: string | undefined;
	STORAGE_DRIVER: string;
	S3_BUCKET?: string | undefined;
	QUEUE_DRIVER: string;
	QUEUE_URL?: string | undefined;
	EXIT_NODE_DRIVER: string;
	EXIT_NODE_API_URL?: string | undefined;
}): void {
	if (env.BILLING_DRIVER === 'stripe' && env.STRIPE_API_BASE) {
		throw new Error(
			`STRIPE_API_BASE is set (${env.STRIPE_API_BASE}), which aims the Stripe SDK at a mock, ` +
				'and no mock we run implements /v1/checkout/sessions — a checkout can only fail there. ' +
				'Either unset it and use Stripe test-mode keys with `stripe listen` ' +
				'(docs/06-AMBIENTE-LOCAL.md), or set BILLING_DRIVER=memory to work offline. ' +
				'The adapters integration suite reaches localstripe without this variable.',
		);
	}

	const missing: string[] = [];

	if (env.CACHE_DRIVER === 'redis' && !env.REDIS_URL)
		missing.push('REDIS_URL (CACHE_DRIVER=redis)');
	if (env.EMAIL_DRIVER === 'smtp') {
		if (!env.SMTP_HOST) missing.push('SMTP_HOST (EMAIL_DRIVER=smtp)');
		if (!env.SMTP_PORT) missing.push('SMTP_PORT (EMAIL_DRIVER=smtp)');
	}
	if (env.BILLING_DRIVER === 'stripe') {
		if (!env.STRIPE_API_KEY) missing.push('STRIPE_API_KEY (BILLING_DRIVER=stripe)');
		if (!env.STRIPE_WEBHOOK_SECRET) missing.push('STRIPE_WEBHOOK_SECRET (BILLING_DRIVER=stripe)');
		if (!env.STRIPE_PRICE_ID) missing.push('STRIPE_PRICE_ID (BILLING_DRIVER=stripe)');
		if (!env.STRIPE_PRICE_ID_YEARLY) missing.push('STRIPE_PRICE_ID_YEARLY (BILLING_DRIVER=stripe)');
	}
	if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) missing.push('S3_BUCKET (STORAGE_DRIVER=s3)');
	if (env.QUEUE_DRIVER === 'sqs' && !env.QUEUE_URL) missing.push('QUEUE_URL (QUEUE_DRIVER=sqs)');
	if (env.EXIT_NODE_DRIVER === 'http' && !env.EXIT_NODE_API_URL)
		missing.push('EXIT_NODE_API_URL (EXIT_NODE_DRIVER=http)');

	if (missing.length > 0) {
		throw new Error(`missing environment configuration:\n  - ${missing.join('\n  - ')}`);
	}
}
