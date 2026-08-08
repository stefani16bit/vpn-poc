import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertDriverConfiguration } from './concerns.js';
import { loadEnv, loadWorkspaceDotenv, resetEnvCache } from './index.js';

const minimal = {
	WEB_ORIGIN: 'http://127.0.0.1:5173',
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

describe('loadEnv and the dotenv files', () => {
	// `pnpm --filter <pkg> dev` runs every script with the cwd set to the
	// package, never to the repository root, so a cwd-relative lookup finds
	// nothing on a machine that was set up exactly as documented.
	function workspace(): { root: string; pkg: string } {
		const root = mkdtempSync(join(tmpdir(), 'vpn-env-'));
		const pkg = join(root, 'apps', 'api');
		mkdirSync(pkg, { recursive: true });
		writeFileSync(join(root, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n");
		return { root, pkg };
	}

	function withCwd(dir: string, body: () => void): void {
		const previous = process.cwd();
		const overwritten = { ...process.env };
		for (const key of Object.keys(minimal)) delete process.env[key];
		resetEnvCache();
		try {
			process.chdir(dir);
			body();
		} finally {
			process.chdir(previous);
			process.env = overwritten;
			resetEnvCache();
		}
	}

	it('reads the env files from the workspace root, not from the cwd', () => {
		const { root, pkg } = workspace();
		writeFileSync(
			join(root, '.env.local'),
			[
				'WEB_ORIGIN=http://root.example',
				`DATABASE_URL=${minimal.DATABASE_URL}`,
				`AUTH_JWT_SECRET=${minimal.AUTH_JWT_SECRET}`,
			].join('\n'),
		);

		try {
			withCwd(pkg, () => {
				expect(loadEnv().WEB_ORIGIN).toBe('http://root.example');
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	// A migration runs with the database url and nothing else, so validating the
	// whole application schema to read a dotenv file would reject a machine that
	// is configured correctly for the only thing it is about to do.
	it('exposes the file lookup on its own, without validating anything', () => {
		const { root, pkg } = workspace();
		writeFileSync(join(root, '.env'), 'DATABASE_MIGRATION_URL=postgres://migrator@localhost/db\n');

		try {
			withCwd(pkg, () => {
				delete process.env['DATABASE_MIGRATION_URL'];
				loadWorkspaceDotenv();
				expect(process.env['DATABASE_MIGRATION_URL']).toBe('postgres://migrator@localhost/db');
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('lets .env.local win over .env', () => {
		const { root, pkg } = workspace();
		const required = [
			`DATABASE_URL=${minimal.DATABASE_URL}`,
			`AUTH_JWT_SECRET=${minimal.AUTH_JWT_SECRET}`,
		];
		writeFileSync(
			join(root, '.env'),
			['WEB_ORIGIN=http://committed.example', ...required].join('\n'),
		);
		writeFileSync(
			join(root, '.env.local'),
			['WEB_ORIGIN=http://local.example', ...required].join('\n'),
		);

		try {
			withCwd(pkg, () => {
				expect(loadEnv().WEB_ORIGIN).toBe('http://local.example');
			});
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('assertDriverConfiguration', () => {
	const base = {
		CACHE_DRIVER: 'memory',
		EMAIL_DRIVER: 'memory',
		BILLING_DRIVER: 'memory',
		STORAGE_DRIVER: 'memory',
		QUEUE_DRIVER: 'memory',
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

	const stripe = {
		...base,
		BILLING_DRIVER: 'stripe',
		STRIPE_API_KEY: 'sk_test',
		STRIPE_WEBHOOK_SECRET: 'whsec_test',
		STRIPE_PRICE_ID: 'price_monthly',
		STRIPE_PRICE_ID_YEARLY: 'price_yearly',
	};

	it('demands a price for both cadences, since either button would 500 without one', () => {
		let message = '';
		try {
			assertDriverConfiguration({
				...stripe,
				STRIPE_PRICE_ID: undefined,
				STRIPE_PRICE_ID_YEARLY: undefined,
			});
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('STRIPE_PRICE_ID ');
		expect(message).toContain('STRIPE_PRICE_ID_YEARLY');
	});

	it('refuses the stripe driver aimed at a mock, which cannot create a checkout', () => {
		expect(() =>
			assertDriverConfiguration({ ...stripe, STRIPE_API_BASE: 'http://127.0.0.1:28420' }),
		).toThrow(/checkout\/sessions/);
	});

	it('accepts the stripe driver against the real API', () => {
		expect(() => assertDriverConfiguration(stripe)).not.toThrow();
	});

	it('leaves a mock base alone when the billing driver is not stripe', () => {
		expect(() =>
			assertDriverConfiguration({ ...base, STRIPE_API_BASE: 'http://127.0.0.1:28420' }),
		).not.toThrow();
	});

	it('demands a bucket when the storage driver is s3', () => {
		expect(() => assertDriverConfiguration({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
	});

	it('demands a queue URL when the queue driver is sqs', () => {
		expect(() => assertDriverConfiguration({ ...base, QUEUE_DRIVER: 'sqs' })).toThrow(/QUEUE_URL/);
	});

	it('ignores configuration belonging to a driver that is not selected', () => {
		expect(() => assertDriverConfiguration({ ...base, REDIS_URL: undefined })).not.toThrow();
	});
});
