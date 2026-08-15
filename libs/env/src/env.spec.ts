import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { assertDriverConfiguration } from './concerns.js';
import { loadEnv, loadWorkspaceDotenv, resetEnvCache } from './index.js';

const minimal = {
	WEB_ORIGIN: 'http://127.0.0.1:5173',
	DATABASE_URL: 'postgres://user:pass@127.0.0.1:25432/db',
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
			loadEnv({ source: { API_PORT: '3000' } });
		} catch (error) {
			message = (error as Error).message;
		}
		expect(message).toContain('WEB_ORIGIN');
		expect(message).toContain('DATABASE_URL');
	});

	// The negative that keeps item 1 from quietly regressing: the signing secret
	// is not a key here any more, so a value under this name reaches nothing. A
	// schema that grew it back would fail here rather than in a review.
	it('carries no signing secret, only the ref where it lives', () => {
		const env = loadEnv({ source: { ...minimal, AUTH_JWT_SECRET: 'x'.repeat(32) } });

		expect(env).not.toHaveProperty('AUTH_JWT_SECRET');
		expect(env.AUTH_JWT_SECRET_REF).toBe('poc-vpn/auth/jwt-secret');
	});

	it('refuses a blank ref, which would resolve to nothing at boot', () => {
		expect(() => loadEnv({ source: { ...minimal, AUTH_JWT_SECRET_REF: '   ' } })).toThrow(
			/AUTH_JWT_SECRET_REF/,
		);
	});

	// One driver, so there is no offline path that reads secrets from the
	// environment — the thing this whole change removes.
	it('has no memory driver for the secret store', () => {
		expect(() => loadEnv({ source: { ...minimal, SECRETS_DRIVER: 'memory' } })).toThrow(
			/SECRETS_DRIVER/,
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
			['WEB_ORIGIN=http://root.example', `DATABASE_URL=${minimal.DATABASE_URL}`].join('\n'),
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
		const required = [`DATABASE_URL=${minimal.DATABASE_URL}`];
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
		EXIT_NODE_DRIVER: 'memory',
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

	it('demands a webhook secret ref when the billing driver is stripe', () => {
		expect(() =>
			assertDriverConfiguration({ ...base, BILLING_DRIVER: 'stripe', STRIPE_API_KEY: 'sk_test' }),
		).toThrow(/STRIPE_WEBHOOK_SECRET_REF/);
	});

	const stripe = {
		...base,
		BILLING_DRIVER: 'stripe',
		STRIPE_API_KEY: 'sk_test',
		STRIPE_WEBHOOK_SECRET_REF: 'poc-vpn/billing/stripe-webhook-secret',
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

	it('demands an exit node URL when the exit node driver is http', () => {
		expect(() => assertDriverConfiguration({ ...base, EXIT_NODE_DRIVER: 'http' })).toThrow(
			/EXIT_NODE_API_URL/,
		);
	});

	// No credential is demanded here any more: each node's comes from the secret
	// store at the ref its row carries, so the environment has nothing to hold.
	it('lets the http exit node through once it has somewhere to call', () => {
		expect(() =>
			assertDriverConfiguration({
				...base,
				EXIT_NODE_DRIVER: 'http',
				EXIT_NODE_API_URL: 'http://127.0.0.1:21821',
			}),
		).not.toThrow();
	});

	it('demands a queue URL when the queue driver is sqs', () => {
		expect(() => assertDriverConfiguration({ ...base, QUEUE_DRIVER: 'sqs' })).toThrow(/QUEUE_URL/);
	});

	it('ignores configuration belonging to a driver that is not selected', () => {
		expect(() => assertDriverConfiguration({ ...base, REDIS_URL: undefined })).not.toThrow();
	});
});
