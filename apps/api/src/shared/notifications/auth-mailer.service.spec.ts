import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '@vpn-poc/env';
import type { User } from '../identity/user.js';
import { MemoryEmailSender } from '@vpn/testing/fakes';

import { runWithContext } from '../http/request-context.js';
import { AuthMailer } from './auth-mailer.service.js';

// AuthMailer reads only WEB_ORIGIN off Env.
const env = { WEB_ORIGIN: 'https://app.example.com' } as Env;

function account(overrides: Partial<User> = {}): User {
	return {
		id: 'acc-1',
		email: 'ada@example.com',
		locale: 'pt-BR',
		emailVerifiedAt: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	} as User;
}

describe('AuthMailer', () => {
	let email: MemoryEmailSender;
	let mailer: AuthMailer;

	beforeEach(() => {
		email = new MemoryEmailSender();
		mailer = new AuthMailer(email, env);
	});

	it('builds the verification url from WEB_ORIGIN and the token', async () => {
		await mailer.sendVerification(account(), 'the-token', 3600);

		expect(email.sent[0]?.variables['url']).toBe(
			'https://app.example.com/verify-email?token=the-token',
		);
	});

	it('builds the reset url on the reset route', async () => {
		await mailer.sendPasswordReset(account(), 'the-token', 3600);

		expect(email.sent[0]?.variables['url']).toBe(
			'https://app.example.com/reset-password?token=the-token',
		);
	});

	it('renders one hour as "1"', async () => {
		await mailer.sendVerification(account(), 'tok', 3600);
		expect(email.sent[0]?.variables['expiresInHours']).toBe('1');
	});

	it('never renders zero hours for a sub-hour ttl', async () => {
		await mailer.sendVerification(account(), 'tok', 600);
		expect(email.sent[0]?.variables['expiresInHours']).toBe('1');
	});

	it('rounds a multi-hour ttl', async () => {
		await mailer.sendVerification(account(), 'tok', 3 * 3600);
		expect(email.sent[0]?.variables['expiresInHours']).toBe('3');
	});

	it('uses the account locale, not the locale of the request', async () => {
		await runWithContext({ correlationId: 'c', locale: 'en', module: 'system' }, async () => {
			await mailer.sendVerification(account({ locale: 'pt-BR' }), 'tok', 3600);
		});

		expect(email.sent[0]?.locale).toBe('pt-BR');
	});

	it('derives the idempotency key from the token, so a resend is a new send', async () => {
		await mailer.sendVerification(account(), 'first-token-aaaaaaaaaaaaaaaaaa', 3600);
		await mailer.sendVerification(account(), 'second-token-bbbbbbbbbbbbbbbbb', 3600);

		expect(email.sent).toHaveLength(2);
	});

	it('collapses a repeated send of the same token', async () => {
		await mailer.sendVerification(account(), 'same-token-aaaaaaaaaaaaaaaaaaa', 3600);
		await mailer.sendVerification(account(), 'same-token-aaaaaaaaaaaaaaaaaaa', 3600);

		expect(email.sent).toHaveLength(1);
	});

	it('keys the welcome mail on the account, so it cannot be sent twice', async () => {
		await mailer.sendWelcome(account());
		await mailer.sendWelcome(account());

		expect(email.sent).toHaveLength(1);
		expect(email.sent[0]?.template).toBe('welcome');
	});

	it('keys password-changed on the second it happened', async () => {
		const at = new Date('2026-05-06T07:08:09.000Z');
		await mailer.sendPasswordChanged(account(), at);

		expect(email.sent[0]?.idempotencyKey).toBe(
			`password-changed:acc-1:${Math.floor(at.getTime() / 1000)}`,
		);
	});
});
