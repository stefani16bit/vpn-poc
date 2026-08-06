import { describe, expect, it } from 'vitest';

import { assertDriverConfiguration } from './concerns.js';
import { loadEnv } from './index.js';

const minimal = {
	WEB_ORIGIN: 'http://localhost:5173',
	DATABASE_URL: 'postgres://user:pass@127.0.0.1:25432/db',
	AUTH_JWT_SECRET: 'x'.repeat(32),
};

describe('loadEnv', () => {
	it('accepts a minimal environment and fills the defaults', () => {
		const env = loadEnv({ source: minimal });
		expect(env.NODE_ENV).toBe('development');
		expect(env.API_PORT).toBe(3000);
		expect(env.AUTH_ACCESS_TOKEN_TTL).toBe(900);
		expect(env.CACHE_DRIVER).toBe('memory');
	});

	it('coerces numeric values that arrive as strings', () => {
		const env = loadEnv({ source: { ...minimal, API_PORT: '4000' } });
		expect(env.API_PORT).toBe(4000);
	});

	it('reports every problem in a single error', () => {
		let message = '';
		try {
			loadEnv({ source: { AUTH_JWT_SECRET: 'too-short' } });
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('WEB_ORIGIN');
		expect(message).toContain('DATABASE_URL');
		expect(message).toContain('AUTH_JWT_SECRET');
	});

	it('rejects a JWT secret short enough to brute-force offline', () => {
		expect(() => loadEnv({ source: { ...minimal, AUTH_JWT_SECRET: 'short' } })).toThrow(
			/AUTH_JWT_SECRET/,
		);
	});

	it('rejects an unknown driver rather than falling back to a default', () => {
		expect(() => loadEnv({ source: { ...minimal, CACHE_DRIVER: 'memcached' } })).toThrow();
	});
});

describe('assertDriverConfiguration', () => {
	const base = {
		CACHE_DRIVER: 'memory',
		EMAIL_DRIVER: 'memory',
		BILLING_DRIVER: 'memory',
		STORAGE_DRIVER: 'memory',
	};

	it('passes when every driver is in-memory', () => {
		expect(() => assertDriverConfiguration(base)).not.toThrow();
	});

	it('demands a Redis URL when the cache driver is redis', () => {
		expect(() => assertDriverConfiguration({ ...base, CACHE_DRIVER: 'redis' })).toThrow(
			/REDIS_URL/,
		);
	});

	it('demands SMTP host and port when the e-mail driver is smtp', () => {
		let message = '';
		try {
			assertDriverConfiguration({ ...base, EMAIL_DRIVER: 'smtp' });
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('SMTP_HOST');
		expect(message).toContain('SMTP_PORT');
	});

	it('demands a webhook secret when the billing driver is stripe', () => {
		expect(() =>
			assertDriverConfiguration({ ...base, BILLING_DRIVER: 'stripe', STRIPE_API_KEY: 'sk_test' }),
		).toThrow(/STRIPE_WEBHOOK_SECRET/);
	});

	it('demands a bucket when the storage driver is s3', () => {
		expect(() => assertDriverConfiguration({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
	});

	it('ignores configuration belonging to a driver that is not selected', () => {
		expect(() => assertDriverConfiguration({ ...base, REDIS_URL: undefined })).not.toThrow();
	});
});
