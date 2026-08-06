import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '@vpn-poc/database';
import {
	describeCacheStoreContract,
	describeEmailSenderContract,
	describeIdentityProviderContract,
	describeObjectStorageContract,
	describePasswordHasherContract,
	describeSmsSenderContract,
	type SentEmail,
} from '@vpn/testing/contracts';
import type { IObjectStorage } from '@vpn/ports';
import { FixedClock, MemoryCacheStore } from '@vpn/testing/fakes';
import { Redis } from 'ioredis';
import { createTransport } from 'nodemailer';

import { RedisCacheStore } from './cache/RedisCacheStore.js';
import { ScryptPasswordHasher } from './crypto/ScryptPasswordHasher.js';
import { SmtpEmailSender } from './email/SmtpEmailSender.js';
import { DrizzleIdentityProvider } from './identity/DrizzleIdentityProvider.js';
import { INTEGRATION } from './integration.env.js';
import { ConsoleSmsSender } from './sms/ConsoleSmsSender.js';
import { S3ObjectStorage } from './storage/S3ObjectStorage.js';

let sharedRedis: Redis;

beforeAll(() => {
	sharedRedis = new Redis(INTEGRATION.redisUrl, { maxRetriesPerRequest: 3 });
});

afterAll(async () => {
	await sharedRedis.quit();
});

describeCacheStoreContract('RedisCacheStore', async () => {
	const prefix = `it-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	const store = new RedisCacheStore(sharedRedis, prefix);

	return {
		store,
		advance: async (seconds: number) => {
			const keys = await sharedRedis.keys(`${prefix}:*`);
			for (const key of keys) {
				const remainingMs = await sharedRedis.pttl(key);
				if (remainingMs <= 0) continue;

				const next = remainingMs - seconds * 1000;
				if (next <= 0) await sharedRedis.del(key);
				else await sharedRedis.pexpire(key, next);
			}
		},
	};
});

const { db, sql } = createDatabase({ url: INTEGRATION.databaseUrl, maxConnections: 4 });

afterAll(async () => {
	await sql.end({ timeout: 5 });
});

async function truncateIdentityTables(): Promise<void> {
	await sql`DELETE FROM accounts`;
}

describe('DrizzleIdentityProvider', () => {
	beforeEach(truncateIdentityTables);
	afterAll(truncateIdentityTables);

	describeIdentityProviderContract('DrizzleIdentityProvider', () => {
		const clock = new FixedClock();
		return {
			provider: new DrizzleIdentityProvider(db, new FakeHasherForSpeed(), clock, {
				refreshTokenTtlSeconds: 30 * 24 * 60 * 60,
			}),
			advance: (seconds) => clock.advance(seconds),
		};
	});
});

class FakeHasherForSpeed {
	async hash(plaintext: string): Promise<string> {
		return `fake$${plaintext}`;
	}
	async verify(plaintext: string, hash: string): Promise<boolean> {
		return hash.startsWith('fake$') && hash.slice(5) === plaintext;
	}
	needsRehash(hash: string): boolean {
		return !hash.startsWith('fake$');
	}
}

describePasswordHasherContract('ScryptPasswordHasher', () => new ScryptPasswordHasher());

describe('ScryptPasswordHasher specifics', () => {
	const hasher = new ScryptPasswordHasher();

	it('produces a different hash for the same password each time', async () => {
		const [first, second] = await Promise.all([
			hasher.hash('same-password'),
			hasher.hash('same-password'),
		]);
		expect(first).not.toBe(second);
	});

	it('embeds its parameters, so raising them does not invalidate stored hashes', async () => {
		const weak = new ScryptPasswordHasher({ N: 2 ** 14, r: 8, p: 1 });
		const stored = await weak.hash('a-sufficiently-long-password');

		await expect(hasher.verify('a-sufficiently-long-password', stored)).resolves.toBe(true);
		expect(hasher.needsRehash(stored)).toBe(true);
	});

	it('does not ask to rehash a stronger stored hash', async () => {
		const strong = new ScryptPasswordHasher({ N: 2 ** 18, r: 8, p: 1 });
		const stored = await strong.hash('a-sufficiently-long-password');
		expect(hasher.needsRehash(stored)).toBe(false);
	});

	it('rejects a hash whose parameters were tampered with', async () => {
		const stored = await hasher.hash('a-sufficiently-long-password');
		const tampered = stored.replace(/^scrypt\$\d+/, 'scrypt$2');
		await expect(hasher.verify('a-sufficiently-long-password', tampered)).resolves.toBe(false);
	});
});

interface MailpitMessage {
	readonly To: readonly { readonly Address: string }[];
	readonly Subject: string;
}

async function mailpit<T>(path: string, init?: RequestInit): Promise<T> {
	const response = await fetch(`${INTEGRATION.mailpitUrl}${path}`, init);
	if (!response.ok) throw new Error(`mailpit ${path}: HTTP ${response.status}`);
	return (await response.json()) as T;
}

describe('SmtpEmailSender', () => {
	beforeEach(async () => {
		await fetch(`${INTEGRATION.mailpitUrl}/api/v1/messages`, { method: 'DELETE' });
	});

	describeEmailSenderContract('SmtpEmailSender', () => {
		const transport = createTransport({
			host: INTEGRATION.smtpHost,
			port: INTEGRATION.smtpPort,
			secure: false,
		});

		const sender = new SmtpEmailSender(transport, new MemoryCacheStore(new FixedClock()), {
			from: 'poc-vpn <no-reply@poc-vpn.local>',
		});

		return {
			sender,
			inspect: async (): Promise<readonly SentEmail[]> => {
				const inbox = await mailpit<{ messages: MailpitMessage[] }>('/api/v1/messages');
				return [...inbox.messages].reverse().map((message) => ({
					to: message.To[0]?.Address ?? '',
					template: subjectToTemplate(message.Subject),
				}));
			},
		};
	});
});

function subjectToTemplate(subject: string): string {
	const bySubject: Record<string, string> = {
		'Confirme seu e-mail': 'verify_email',
		'Redefinição de senha': 'reset_password',
		'Sua senha foi alterada': 'password_changed',
		'Sua conta está ativa': 'welcome',
		'Não conseguimos processar seu pagamento': 'payment_failed',
		'Assinatura cancelada': 'subscription_canceled',
	};
	return bySubject[subject] ?? subject;
}

describe('ConsoleSmsSender', () => {
	describeSmsSenderContract('ConsoleSmsSender', () => {
		const lines: string[] = [];
		const sender = new ConsoleSmsSender(new MemoryCacheStore(new FixedClock()), {
			nodeEnv: 'test',
			log: (line) => lines.push(line),
		});
		return {
			sender,
			inspect: () =>
				lines.map((line) => ({
					phoneNumber: /to=(\S+)/.exec(line)?.[1] ?? '',
					template: /^\[sms:([^\]]+)\]/.exec(line)?.[1] ?? '',
				})),
		};
	});

	it('refuses to be constructed in production', () => {
		expect(
			() =>
				new ConsoleSmsSender(new MemoryCacheStore(new FixedClock()), {
					nodeEnv: 'production',
					log: () => {},
				}),
		).toThrow(/production/);
	});
});

describe('S3ObjectStorage', () => {
	const storage = new S3ObjectStorage({
		bucket: INTEGRATION.s3Bucket,
		region: INTEGRATION.awsRegion,
		endpoint: INTEGRATION.s3Endpoint,
	});

	const namespace = `it-${Date.now()}`;
	const namespaced: IObjectStorage = {
		put: (key, body, contentType) => storage.put(`${namespace}/${key}`, body, contentType),
		get: (key) => storage.get(`${namespace}/${key}`),
		delete: (key) => storage.delete(`${namespace}/${key}`),
		signedUrl: (key, ttl) => storage.signedUrl(`${namespace}/${key}`, ttl),
	};

	describeObjectStorageContract('S3ObjectStorage', () => namespaced);

	it('signs a URL that a client with no credentials can fetch', async () => {
		await storage.put(`${namespace}/public.txt`, new TextEncoder().encode('signed'), 'text/plain');
		const url = await storage.signedUrl(`${namespace}/public.txt`, 300);

		const response = await fetch(url);
		expect(response.status).toBe(200);
		await expect(response.text()).resolves.toBe('signed');
	});
});

afterEach(() => {
	expect(process.listenerCount('unhandledRejection')).toBeLessThan(50);
});
