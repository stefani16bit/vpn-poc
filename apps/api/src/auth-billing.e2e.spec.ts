import { MAILPIT_URL } from './e2e.setup.js';

import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DATABASE_CONNECTION } from '@vpn-poc/adapters';
import { ENTITLEMENTS, UNSUBSCRIBED_ENTITLEMENTS } from '@vpn/contracts';
import { BILLING_PROVIDER, type SubscriptionStatus } from '@vpn/ports';
import type { MemoryBillingProvider } from '@vpn/testing/fakes';

import type { createDatabase } from '@vpn-poc/database';

import { createApp } from './bootstrap.js';
import { AccessTokenService } from './shared/access-control/access-token.service.js';
import { OutboxConsumer } from './shared/outbox/outbox-consumer.js';
import { OutboxRelay } from './shared/outbox/outbox-relay.js';
import { OutboxRepository } from './shared/outbox/outbox.repository.js';

let app: INestApplication;
let sql: ReturnType<typeof createDatabase>['sql'];
let db: Awaited<ReturnType<ReturnType<typeof createDatabase>['sql']['reserve']>>;

const PASSWORD = 'a-sufficiently-long-password';
const NEW_PASSWORD = 'an-entirely-different-password';

beforeAll(async () => {
	app = await createApp();
	await app.init();
	sql = (app.get(DATABASE_CONNECTION) as { sql: typeof sql }).sql;

	// Under RLS a tenant connection reads nothing here: the suite inspects rows
	// across accounts, which is exactly what app_system exists for.
	db = await sql.reserve();
	await db`set role app_system`;
});

afterAll(async () => {
	db.release();
	await app.close();
});

async function drainNotifications(): Promise<void> {
	await app.get(OutboxRelay).runOnce();
	await app.get(OutboxConsumer).runOnce();
}

beforeEach(async () => {
	await db`DELETE FROM billing_events`;
	await db`DELETE FROM outbox`;
	// A live device refuses to be deleted, cascade included, so the reset has to
	// do what a real deletion path has to do: revoke first.
	await db`UPDATE devices SET revoked_at = now() WHERE revoked_at IS NULL`;
	await db`DELETE FROM accounts`;
	await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
});

let counter = 0;
function freshEmail(): string {
	counter += 1;
	return `e2e-${Date.now()}-${counter}@example.com`;
}

interface MailpitSummary {
	readonly ID: string;
	readonly Subject: string;
	readonly To: readonly { readonly Address: string }[];
}

async function mailpitCount(): Promise<number> {
	const response = await fetch(`${MAILPIT_URL}/api/v1/messages`);
	const payload = (await response.json()) as { messages: MailpitSummary[] };
	return payload.messages.length;
}

async function inbox(): Promise<readonly MailpitSummary[]> {
	await drainNotifications();
	const response = await fetch(`${MAILPIT_URL}/api/v1/messages`);
	const payload = (await response.json()) as { messages: MailpitSummary[] };
	return payload.messages;
}

async function latestMessageFor(address: string): Promise<{ subject: string; body: string }> {
	const messages = await inbox();
	const found = messages.find((message) => message.To[0]?.Address === address);
	if (!found) throw new Error(`no message for ${address}; inbox has ${messages.length}`);

	const response = await fetch(`${MAILPIT_URL}/api/v1/message/${found.ID}`);
	const detail = (await response.json()) as { Text: string; Subject: string };
	return { subject: detail.Subject, body: detail.Text };
}

async function tokenFromMail(address: string): Promise<string> {
	const { body } = await latestMessageFor(address);
	const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(body);
	if (!match?.[1]) throw new Error(`no token in mail body:\n${body}`);
	return match[1];
}

async function registerAndVerify(address: string): Promise<void> {
	await request(app.getHttpServer())
		.post('/auth/register')
		.send({ email: address, password: PASSWORD })
		.expect(202);

	await request(app.getHttpServer())
		.post('/auth/verify-email')
		.send({ token: await tokenFromMail(address) })
		.expect(200);
}

async function registeredUser(): Promise<{ userId: string; accountId: string }> {
	const email = freshEmail();
	await request(app.getHttpServer())
		.post('/auth/register')
		.send({ email, password: PASSWORD })
		.expect(202);

	const [row] = await db`SELECT id, account_id FROM users WHERE email = ${email}`;
	await db`DELETE FROM outbox`;
	await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });

	return { userId: String(row?.['id']), accountId: String(row?.['account_id']) };
}

async function queueWelcome(accountId: string, userId: string): Promise<void> {
	const payload = JSON.stringify({ kind: 'auth.welcome', userId });
	await db`
		INSERT INTO outbox (account_id, kind, payload)
		VALUES (${accountId}, 'auth.welcome', ${payload}::jsonb)
	`;
}

async function loginFor(address: string, password = PASSWORD) {
	const response = await request(app.getHttpServer())
		.post('/auth/login')
		.send({ email: address, password })
		.expect(200);
	return response;
}

describe('registration and verification', () => {
	it('registers, mails a verification link, and verifies', async () => {
		const email = freshEmail();

		await request(app.getHttpServer())
			.post('/auth/register')
			.send({ email, password: PASSWORD })
			.expect(202, { acknowledged: true });

		const mail = await latestMessageFor(email);
		expect(mail.subject).toBe('Confirme seu e-mail');

		await request(app.getHttpServer())
			.post('/auth/verify-email')
			.send({ token: await tokenFromMail(email) })
			.expect(200, { acknowledged: true });
	});

	it('creates the account and its owner in one go', async () => {
		const email = freshEmail();

		await request(app.getHttpServer())
			.post('/auth/register')
			.send({ email, password: PASSWORD })
			.expect(202);

		const rows = await db`
			select a.slug, u.role
			from users u join accounts a on a.id = u.account_id
			where u.email = ${email}
		`;

		expect(rows).toHaveLength(1);
		expect(rows[0]?.['role']).toBe('owner');
		expect(rows[0]?.['slug']).toMatch(/^e2e-/);
	});

	it('suffixes the slug when two addresses derive the same one', async () => {
		const localPart = `slugtest-${Date.now()}`;
		const first = `${localPart}@one.example.com`;
		const second = `${localPart}@two.example.com`;

		await request(app.getHttpServer())
			.post('/auth/register')
			.send({ email: first, password: PASSWORD })
			.expect(202);
		await request(app.getHttpServer())
			.post('/auth/register')
			.send({ email: second, password: PASSWORD })
			.expect(202);

		const slugs = await db`
			select a.slug from users u join accounts a on a.id = u.account_id
			where u.email in (${first}, ${second}) order by a.created_at
		`;

		expect(slugs.map((row) => row['slug'])).toEqual([localPart, `${localPart}-2`]);
	});

	it('refuses a second owner in the same account, by constraint rather than by code', async () => {
		const email = freshEmail();
		await request(app.getHttpServer())
			.post('/auth/register')
			.send({ email, password: PASSWORD })
			.expect(202);

		const [account] = await db`
			select account_id from users where email = ${email}
		`;

		await expect(
			db`
				insert into users (account_id, email, password_hash, role)
				values (${account?.['account_id']}, ${`second-${email}`}, 'x', 'owner')
			`,
		).rejects.toMatchObject({ code: '23505' });
	});

	it('answers a duplicate registration exactly as it answers a new one', async () => {
		const email = freshEmail();

		const first = await request(app.getHttpServer())
			.post('/auth/register')
			.send({ email, password: PASSWORD });

		const second = await request(app.getHttpServer())
			.post('/auth/register')
			.send({ email, password: PASSWORD });

		expect(second.status).toBe(first.status);
		expect(second.body).toEqual(first.body);
	});

	it('does not mail the address owner when someone re-registers it', async () => {
		const email = freshEmail();
		await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });
		await drainNotifications();
		await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });

		await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });

		expect(await inbox()).toHaveLength(0);
	});

	it('rejects a password below the policy, naming the field', async () => {
		const response = await request(app.getHttpServer())
			.post('/auth/register')
			.send({ email: freshEmail(), password: 'short' })
			.expect(400);

		expect(response.body.code).toBe('VALIDATION_FAILED');
		expect(response.body.fields).toHaveProperty('password');
	});

	it('refuses to reuse a verification token', async () => {
		const email = freshEmail();
		await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });
		const token = await tokenFromMail(email);

		await request(app.getHttpServer()).post('/auth/verify-email').send({ token }).expect(200);

		const replay = await request(app.getHttpServer())
			.post('/auth/verify-email')
			.send({ token })
			.expect(400);
		expect(replay.body.code).toBe('TOKEN_INVALID');
	});

	it('invalidates the previous link when verification is resent', async () => {
		const email = freshEmail();
		await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });
		const firstToken = await tokenFromMail(email);

		await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
		await request(app.getHttpServer())
			.post('/auth/resend-verification')
			.send({ email })
			.expect(202);
		const secondToken = await tokenFromMail(email);

		expect(secondToken).not.toBe(firstToken);
		await request(app.getHttpServer())
			.post('/auth/verify-email')
			.send({ token: firstToken })
			.expect(400);
		await request(app.getHttpServer())
			.post('/auth/verify-email')
			.send({ token: secondToken })
			.expect(200);
	});
});

describe('login', () => {
	it('resolves the account when the address exists in exactly one', async () => {
		const email = freshEmail();
		await registerAndVerify(email);

		const response = await loginFor(email);

		const [row] = await db`select account_id from users where email = ${email}`;
		expect(response.body.user.accountId).toBe(row?.['account_id']);
		expect(response.body.user.role).toBe('owner');
	});

	it('accepts a login scoped by the account slug', async () => {
		const email = freshEmail();
		await registerAndVerify(email);
		const [row] = await db`
			select a.slug from users u join accounts a on a.id = u.account_id where u.email = ${email}
		`;

		await request(app.getHttpServer())
			.post('/auth/login')
			.send({ email, password: PASSWORD, slug: row?.['slug'] })
			.expect(200);
	});

	it('answers a slug from another account exactly as it answers a wrong password', async () => {
		const mine = freshEmail();
		const theirs = freshEmail();
		await registerAndVerify(mine);
		await registerAndVerify(theirs);
		const [other] = await db`
			select a.slug from users u join accounts a on a.id = u.account_id where u.email = ${theirs}
		`;

		const crossed = await request(app.getHttpServer())
			.post('/auth/login')
			.send({ email: mine, password: PASSWORD, slug: other?.['slug'] });

		const wrongPassword = await request(app.getHttpServer())
			.post('/auth/login')
			.send({ email: mine, password: 'not-the-right-password' });

		expect(crossed.status).toBe(wrongPassword.status);
		expect({ ...crossed.body, correlationId: undefined }).toEqual({
			...wrongPassword.body,
			correlationId: undefined,
		});
	});

	it('answers an unknown slug the same way, so companies cannot be enumerated', async () => {
		const email = freshEmail();
		await registerAndVerify(email);

		const unknown = await request(app.getHttpServer())
			.post('/auth/login')
			.send({ email, password: PASSWORD, slug: 'no-such-company' });

		expect(unknown.status).toBe(401);
		expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
	});

	it('issues an access token and sets an httpOnly refresh cookie', async () => {
		const email = freshEmail();
		await registerAndVerify(email);

		const response = await loginFor(email);

		expect(response.body.user.email).toBe(email);
		expect(response.body.accessToken).toBeTruthy();
		expect(JSON.stringify(response.body)).not.toContain('poc_vpn_refresh');

		const cookie = (response.headers['set-cookie'] as unknown as string[])[0] ?? '';
		expect(cookie).toContain('poc_vpn_refresh=');
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('SameSite=Lax');
	});

	it('refuses an unverified account with a code the client can act on', async () => {
		const email = freshEmail();
		await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });

		const response = await request(app.getHttpServer())
			.post('/auth/login')
			.send({ email, password: PASSWORD })
			.expect(403);
		expect(response.body.code).toBe('EMAIL_NOT_VERIFIED');
	});

	it('answers a wrong password and an unknown address identically', async () => {
		const email = freshEmail();
		await registerAndVerify(email);

		const wrongPassword = await request(app.getHttpServer())
			.post('/auth/login')
			.send({ email, password: 'not-the-right-password' });

		const unknownAccount = await request(app.getHttpServer())
			.post('/auth/login')
			.send({ email: freshEmail(), password: PASSWORD });

		expect(unknownAccount.status).toBe(wrongPassword.status);
		expect(unknownAccount.body.code).toBe(wrongPassword.body.code);
		expect(unknownAccount.body.message).toBe(wrongPassword.body.message);
	});

	it('returns the current user from the access token', async () => {
		const email = freshEmail();
		await registerAndVerify(email);
		const login = await loginFor(email);

		const me = await request(app.getHttpServer())
			.get('/auth/me')
			.set('Authorization', `Bearer ${login.body.accessToken}`)
			.expect(200);

		expect(me.body).toMatchObject({ email, emailVerified: true });
	});

	it('rejects a request with no token', async () => {
		const response = await request(app.getHttpServer()).get('/auth/me').expect(401);
		expect(response.body.code).toBe('UNAUTHENTICATED');
	});

	it('rejects a forged token', async () => {
		const response = await request(app.getHttpServer())
			.get('/auth/me')
			.set('Authorization', 'Bearer not.a.jwt')
			.expect(400);
		expect(response.body.code).toBe('TOKEN_INVALID');
	});
});

describe('session rotation', () => {
	it('rotates the refresh cookie', async () => {
		const email = freshEmail();
		await registerAndVerify(email);
		const login = await loginFor(email);
		const firstCookie = (login.headers['set-cookie'] as unknown as string[])[0] ?? '';

		const refreshed = await request(app.getHttpServer())
			.post('/auth/refresh')
			.set('Cookie', firstCookie)
			.expect(200);

		const secondCookie = (refreshed.headers['set-cookie'] as unknown as string[])[0] ?? '';
		expect(secondCookie).not.toBe(firstCookie);
		expect(refreshed.body.user.email).toBe(email);
	});

	it('revokes the whole family when a refresh token is replayed', async () => {
		const email = freshEmail();
		await registerAndVerify(email);
		const login = await loginFor(email);
		const stolen = (login.headers['set-cookie'] as unknown as string[])[0] ?? '';

		const rotated = await request(app.getHttpServer())
			.post('/auth/refresh')
			.set('Cookie', stolen)
			.expect(200);
		const legitimate = (rotated.headers['set-cookie'] as unknown as string[])[0] ?? '';

		const replay = await request(app.getHttpServer())
			.post('/auth/refresh')
			.set('Cookie', stolen)
			.expect(401);
		expect(replay.body.code).toBe('SESSION_REUSE_DETECTED');

		await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', legitimate).expect(401);
	});

	it('ends the session on logout', async () => {
		const email = freshEmail();
		await registerAndVerify(email);
		const login = await loginFor(email);
		const cookie = (login.headers['set-cookie'] as unknown as string[])[0] ?? '';

		await request(app.getHttpServer()).post('/auth/logout').set('Cookie', cookie).expect(200);
		await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie).expect(401);
	});

	it('succeeds at logging out when there is no session', async () => {
		await request(app.getHttpServer()).post('/auth/logout').expect(200, { acknowledged: true });
	});
});

describe('password reset', () => {
	it('resets the password and lets the new one in', async () => {
		const email = freshEmail();
		await registerAndVerify(email);
		await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });

		await request(app.getHttpServer())
			.post('/auth/forgot-password')
			.send({ email })
			.expect(202, { acknowledged: true });

		const mail = await latestMessageFor(email);
		expect(mail.subject).toBe('Redefinição de senha');

		await request(app.getHttpServer())
			.post('/auth/reset-password')
			.send({ token: await tokenFromMail(email), password: NEW_PASSWORD })
			.expect(200);

		await request(app.getHttpServer())
			.post('/auth/login')
			.send({ email, password: PASSWORD })
			.expect(401);
		await loginFor(email, NEW_PASSWORD);
	});

	it('acknowledges an unknown address without sending anything', async () => {
		await request(app.getHttpServer())
			.post('/auth/forgot-password')
			.send({ email: freshEmail() })
			.expect(202, { acknowledged: true });

		expect(await inbox()).toHaveLength(0);
	});

	it('kills every existing session when the password is reset', async () => {
		const email = freshEmail();
		await registerAndVerify(email);
		const login = await loginFor(email);
		const cookie = (login.headers['set-cookie'] as unknown as string[])[0] ?? '';

		await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
		await request(app.getHttpServer()).post('/auth/forgot-password').send({ email });
		await request(app.getHttpServer())
			.post('/auth/reset-password')
			.send({ token: await tokenFromMail(email), password: NEW_PASSWORD })
			.expect(200);

		await request(app.getHttpServer()).post('/auth/refresh').set('Cookie', cookie).expect(401);
	});

	it('notifies the account owner that the password changed', async () => {
		const email = freshEmail();
		await registerAndVerify(email);
		await request(app.getHttpServer()).post('/auth/forgot-password').send({ email });
		const token = await tokenFromMail(email);

		await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
		await request(app.getHttpServer())
			.post('/auth/reset-password')
			.send({ token, password: NEW_PASSWORD })
			.expect(200);

		expect((await latestMessageFor(email)).subject).toBe('Sua senha foi alterada');
	});

	it('refuses to reuse a reset token', async () => {
		const email = freshEmail();
		await registerAndVerify(email);
		await request(app.getHttpServer()).post('/auth/forgot-password').send({ email });
		const token = await tokenFromMail(email);

		await request(app.getHttpServer())
			.post('/auth/reset-password')
			.send({ token, password: NEW_PASSWORD })
			.expect(200);

		const replay = await request(app.getHttpServer())
			.post('/auth/reset-password')
			.send({ token, password: 'yet-another-long-password' })
			.expect(400);
		expect(replay.body.code).toBe('TOKEN_INVALID');
	});
});

describe('rate limiting', () => {
	it('stops repeated password reset requests for one address', async () => {
		const email = freshEmail();
		await registerAndVerify(email);

		for (let attempt = 0; attempt < 3; attempt += 1) {
			await request(app.getHttpServer()).post('/auth/forgot-password').send({ email }).expect(202);
		}

		const blocked = await request(app.getHttpServer())
			.post('/auth/forgot-password')
			.send({ email })
			.expect(429);
		expect(blocked.body.code).toBe('RATE_LIMITED');
	});
});

describe('billing', () => {
	function provider(): MemoryBillingProvider {
		return app.get(BILLING_PROVIDER) as MemoryBillingProvider;
	}

	async function subscribedSession() {
		const email = freshEmail();
		await registerAndVerify(email);
		const login = await loginFor(email);
		return {
			email,
			accessToken: login.body.accessToken as string,
			accountId: login.body.user.accountId as string,
		};
	}

	it('creates a checkout session', async () => {
		const session = await subscribedSession();

		const response = await request(app.getHttpServer())
			.post('/billing/checkout')
			.set('Authorization', `Bearer ${session.accessToken}`)
			.send({ tier: 'pro', cadence: 'monthly' })
			.expect(200);

		expect(response.body.checkoutUrl).toContain('price_local_monthly');
	});

	it('returns the same checkout for a repeated request', async () => {
		const session = await subscribedSession();
		const send = () =>
			request(app.getHttpServer())
				.post('/billing/checkout')
				.set('Authorization', `Bearer ${session.accessToken}`)
				.send({ tier: 'pro', cadence: 'monthly' });

		const [first, second] = [await send(), await send()];
		expect(second.body.checkoutUrl).toBe(first.body.checkoutUrl);
	});

	it('requires authentication to start a checkout', async () => {
		await request(app.getHttpServer())
			.post('/billing/checkout')
			.send({ tier: 'pro', cadence: 'monthly' })
			.expect(401);
	});

	it('reports no subscription before one exists', async () => {
		const session = await subscribedSession();

		const response = await request(app.getHttpServer())
			.get('/billing/subscription')
			.set('Authorization', `Bearer ${session.accessToken}`)
			.expect(200);

		expect(response.body).toEqual({
			status: 'none',
			currentPeriodEnd: null,
			cancelAtPeriodEnd: false,
		});
	});

	it('activates the subscription from a signed webhook', async () => {
		const session = await subscribedSession();
		const billing = provider();
		const hook = billing.emit('subscription_activated', session.accountId, {
			subscription: billing.seedSubscription(`sub_${session.accountId}`, session.accountId),
		});

		await request(app.getHttpServer())
			.post('/billing/webhook')
			.set('stripe-signature', hook.signature)
			.set('Content-Type', 'application/json')
			.send(hook.rawBody)
			.expect(200, { applied: true });

		const subscription = await request(app.getHttpServer())
			.get('/billing/subscription')
			.set('Authorization', `Bearer ${session.accessToken}`)
			.expect(200);
		expect(subscription.body.status).toBe('active');
	});

	it('ignores a redelivered webhook', async () => {
		const session = await subscribedSession();
		const billing = provider();
		const hook = billing.emit('subscription_activated', session.accountId, {
			subscription: billing.seedSubscription(`sub_${session.accountId}`, session.accountId),
		});

		const post = () =>
			request(app.getHttpServer())
				.post('/billing/webhook')
				.set('stripe-signature', hook.signature)
				.set('Content-Type', 'application/json')
				.send(hook.rawBody);

		await post().expect(200, { applied: true });
		await post().expect(200, { applied: false });

		const ledger = await db`SELECT count(*)::int AS count FROM billing_events`;
		expect(ledger[0]?.['count']).toBe(1);
	});

	function deliver(hook: { rawBody: string; signature: string }) {
		return request(app.getHttpServer())
			.post('/billing/webhook')
			.set('stripe-signature', hook.signature)
			.set('Content-Type', 'application/json')
			.send(hook.rawBody);
	}

	async function statusOf(accessToken: string) {
		const response = await request(app.getHttpServer())
			.get('/billing/subscription')
			.set('Authorization', `Bearer ${accessToken}`)
			.expect(200);
		return response.body as { status: string; currentPeriodEnd: string | null };
	}

	it('survives two full renewal periods with every event redelivered', async () => {
		const session = await subscribedSession();
		const billing = provider();
		const externalId = `sub_${session.accountId}`;
		const base = billing.seedSubscription(externalId, session.accountId);

		const periods = [
			new Date('2026-09-01T00:00:00.000Z'),
			new Date('2026-10-01T00:00:00.000Z'),
			new Date('2026-11-01T00:00:00.000Z'),
		];

		for (const [index, periodEnd] of periods.entries()) {
			const hook = billing.emit(
				index === 0 ? 'subscription_activated' : 'subscription_updated',
				session.accountId,
				{
					subscription: { ...base, currentPeriodEnd: periodEnd },
					occurredAt: new Date(periodEnd.getTime() - 1000),
				},
			);

			await deliver(hook).expect(200, { applied: true });
			await deliver(hook).expect(200, { applied: false });
			await deliver(hook).expect(200, { applied: false });
		}

		const final = await statusOf(session.accessToken);
		expect(final.status).toBe('active');
		expect(final.currentPeriodEnd).toBe(periods[2]?.toISOString());

		const ledger = await db`SELECT count(*)::int AS count FROM billing_events`;
		expect(ledger[0]?.['count']).toBe(periods.length);
	});

	it('refuses to let a late event walk the period back', async () => {
		const session = await subscribedSession();
		const billing = provider();
		const externalId = `sub_${session.accountId}`;
		const base = billing.seedSubscription(externalId, session.accountId);

		const renewal = billing.emit('subscription_updated', session.accountId, {
			subscription: { ...base, currentPeriodEnd: new Date('2026-10-01T00:00:00.000Z') },
			occurredAt: new Date('2026-09-01T00:00:00.000Z'),
		});
		const stale = billing.emit('subscription_updated', session.accountId, {
			subscription: { ...base, currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z') },
			occurredAt: new Date('2026-08-01T00:00:00.000Z'),
		});

		await deliver(renewal).expect(200, { applied: true });
		await deliver(stale).expect(200, { applied: true });

		const after = await statusOf(session.accessToken);
		expect(after.currentPeriodEnd).toBe('2026-10-01T00:00:00.000Z');
	});

	it('refuses to let a late event resurrect a cancelled subscription', async () => {
		const session = await subscribedSession();
		const billing = provider();
		const externalId = `sub_${session.accountId}`;
		const base = billing.seedSubscription(externalId, session.accountId);

		const canceled = billing.emit('subscription_canceled', session.accountId, {
			subscription: { ...base, status: 'canceled' },
			occurredAt: new Date('2026-09-01T00:00:00.000Z'),
		});
		const stale = billing.emit('subscription_updated', session.accountId, {
			subscription: { ...base, status: 'active' },
			occurredAt: new Date('2026-08-01T00:00:00.000Z'),
		});

		await deliver(canceled).expect(200, { applied: true });
		await deliver(stale).expect(200, { applied: true });

		expect((await statusOf(session.accessToken)).status).toBe('canceled');
	});

	it('follows the dunning cycle from active through past_due and back', async () => {
		const session = await subscribedSession();
		const billing = provider();
		const externalId = `sub_${session.accountId}`;
		const base = billing.seedSubscription(externalId, session.accountId);

		const steps = [
			{ status: 'active' as const, at: '2026-09-01T00:00:00.000Z' },
			{ status: 'past_due' as const, at: '2026-09-02T00:00:00.000Z' },
			{ status: 'active' as const, at: '2026-09-05T00:00:00.000Z' },
		];

		for (const step of steps) {
			const hook = billing.emit('subscription_updated', session.accountId, {
				subscription: { ...base, status: step.status },
				occurredAt: new Date(step.at),
			});
			await deliver(hook).expect(200, { applied: true });
			expect((await statusOf(session.accessToken)).status).toBe(step.status);
		}
	});

	it('rejects a webhook whose signature does not match', async () => {
		const session = await subscribedSession();
		const billing = provider();
		const hook = billing.emit('subscription_activated', session.accountId, {
			subscription: billing.seedSubscription(`sub_${session.accountId}`, session.accountId),
		});

		const response = await request(app.getHttpServer())
			.post('/billing/webhook')
			.set('stripe-signature', 'sig_forged')
			.set('Content-Type', 'application/json')
			.send(hook.rawBody)
			.expect(403);
		expect(response.body.code).toBe('FORBIDDEN');
	});

	it('acknowledges an event type it does not model', async () => {
		const billing = provider();
		const hook = billing.emit('invoice.upcoming', 'irrelevant');

		await request(app.getHttpServer())
			.post('/billing/webhook')
			.set('stripe-signature', hook.signature)
			.set('Content-Type', 'application/json')
			.send(hook.rawBody)
			.expect(200, { applied: false });
	});

	it('mails the account when a payment fails', async () => {
		const session = await subscribedSession();
		await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });

		const billing = provider();
		const hook = billing.emit('payment_failed', session.accountId, {
			externalCustomerId: 'cus_e2e',
		});

		await request(app.getHttpServer())
			.post('/billing/webhook')
			.set('stripe-signature', hook.signature)
			.set('Content-Type', 'application/json')
			.send(hook.rawBody)
			.expect(200, { applied: true });

		expect((await latestMessageFor(session.email)).subject).toBe(
			'Não conseguimos processar seu pagamento',
		);
	});

	it('mails the account when the subscription is activated', async () => {
		const session = await subscribedSession();
		await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });

		const billing = provider();
		const hook = billing.emit('subscription_activated', session.accountId, {
			subscription: billing.seedSubscription(`sub_${session.accountId}`, session.accountId),
		});

		await request(app.getHttpServer())
			.post('/billing/webhook')
			.set('stripe-signature', hook.signature)
			.set('Content-Type', 'application/json')
			.send(hook.rawBody)
			.expect(200, { applied: true });

		expect((await latestMessageFor(session.email)).subject).toBe('Sua assinatura está ativa');
	});

	it('does not mail a second time when the activation is redelivered', async () => {
		const session = await subscribedSession();
		const billing = provider();
		const hook = billing.emit('subscription_activated', session.accountId, {
			subscription: billing.seedSubscription(`sub_${session.accountId}`, session.accountId),
		});

		for (const expected of [true, false]) {
			await request(app.getHttpServer())
				.post('/billing/webhook')
				.set('stripe-signature', hook.signature)
				.set('Content-Type', 'application/json')
				.send(hook.rawBody)
				.expect(200, { applied: expected });
		}

		const queued = await db`
			SELECT id FROM outbox WHERE kind = 'billing.subscription_activated'
		`;
		expect(queued).toHaveLength(1);
	});

	it('cancels at period end and keeps the subscription active', async () => {
		const session = await subscribedSession();
		const billing = provider();
		const hook = billing.emit('subscription_activated', session.accountId, {
			subscription: billing.seedSubscription(`sub_${session.accountId}`, session.accountId),
		});
		await request(app.getHttpServer())
			.post('/billing/webhook')
			.set('stripe-signature', hook.signature)
			.set('Content-Type', 'application/json')
			.send(hook.rawBody);

		const response = await request(app.getHttpServer())
			.delete('/billing/subscription')
			.set('Authorization', `Bearer ${session.accessToken}`)
			.expect(200);

		expect(response.body).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
	});

	it('undoes a scheduled cancellation', async () => {
		const session = await subscribedSession();
		const billing = provider();
		const hook = billing.emit('subscription_activated', session.accountId, {
			subscription: billing.seedSubscription(`sub_${session.accountId}`, session.accountId),
		});
		await deliver(hook);

		await request(app.getHttpServer())
			.delete('/billing/subscription')
			.set('Authorization', `Bearer ${session.accessToken}`)
			.expect(200);

		const response = await request(app.getHttpServer())
			.post('/billing/subscription/resume')
			.set('Authorization', `Bearer ${session.accessToken}`)
			.expect(200);

		expect(response.body).toMatchObject({ status: 'active', cancelAtPeriodEnd: false });
	});

	it('mails the activation even when the subscription is created before it is paid', async () => {
		const session = await subscribedSession();
		const billing = provider();
		const seeded = billing.seedSubscription(`sub_${session.accountId}`, session.accountId);
		await db`DELETE FROM outbox`;

		await deliver(
			billing.emit('subscription_activated', session.accountId, {
				subscription: { ...seeded, status: 'incomplete' },
				occurredAt: new Date('2026-12-01T00:00:00.000Z'),
			}),
		).expect(200, { applied: true });
		expect(await db`SELECT id FROM outbox`).toHaveLength(0);

		await deliver(
			billing.emit('subscription_updated', session.accountId, {
				subscription: { ...seeded, status: 'active' },
				occurredAt: new Date('2026-12-02T00:00:00.000Z'),
			}),
		).expect(200, { applied: true });

		const queued = await db`SELECT kind FROM outbox`;
		expect(queued.map((row) => row['kind'])).toEqual(['billing.subscription_activated']);
	});

	it('tells the account its cancellation was scheduled, once', async () => {
		const session = await subscribedSession();
		const billing = provider();
		await deliver(
			billing.emit('subscription_activated', session.accountId, {
				subscription: billing.seedSubscription(`sub_${session.accountId}`, session.accountId),
			}),
		);
		await db`DELETE FROM outbox`;

		for (const _attempt of [1, 2]) {
			await request(app.getHttpServer())
				.delete('/billing/subscription')
				.set('Authorization', `Bearer ${session.accessToken}`)
				.expect(200);
		}

		const queued = await db`
			SELECT id FROM outbox WHERE kind = 'billing.cancellation_scheduled'
		`;
		expect(queued).toHaveLength(1);
	});

	it('mails the scheduled cancellation through the same relay as everything else', async () => {
		const session = await subscribedSession();
		const billing = provider();
		await deliver(
			billing.emit('subscription_activated', session.accountId, {
				subscription: billing.seedSubscription(`sub_${session.accountId}`, session.accountId),
			}),
		);

		await request(app.getHttpServer())
			.delete('/billing/subscription')
			.set('Authorization', `Bearer ${session.accessToken}`)
			.expect(200);

		await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
		await drainNotifications();

		expect((await latestMessageFor(session.email)).subject).toBe('Seu cancelamento foi agendado');
	});

	it('tells the account its subscription was resumed', async () => {
		const session = await subscribedSession();
		const billing = provider();
		await deliver(
			billing.emit('subscription_activated', session.accountId, {
				subscription: billing.seedSubscription(`sub_${session.accountId}`, session.accountId),
			}),
		);
		await request(app.getHttpServer())
			.delete('/billing/subscription')
			.set('Authorization', `Bearer ${session.accessToken}`)
			.expect(200);
		await db`DELETE FROM outbox`;

		await request(app.getHttpServer())
			.post('/billing/subscription/resume')
			.set('Authorization', `Bearer ${session.accessToken}`)
			.expect(200);

		const queued = await db`SELECT kind FROM outbox`;
		expect(queued.map((row) => row['kind'])).toEqual(['billing.subscription_resumed']);
	});

	it('does not mail twice when the provider echoes the cancellation back as a webhook', async () => {
		const session = await subscribedSession();
		const billing = provider();
		const seeded = billing.seedSubscription(`sub_${session.accountId}`, session.accountId);
		await deliver(
			billing.emit('subscription_activated', session.accountId, { subscription: seeded }),
		);
		await request(app.getHttpServer())
			.delete('/billing/subscription')
			.set('Authorization', `Bearer ${session.accessToken}`)
			.expect(200);

		await deliver(
			billing.emit('subscription_updated', session.accountId, {
				subscription: { ...seeded, cancelAtPeriodEnd: true },
				occurredAt: new Date('2026-12-01T00:00:00.000Z'),
			}),
		).expect(200, { applied: true });

		const queued = await db`
			SELECT id FROM outbox WHERE kind = 'billing.cancellation_scheduled'
		`;
		expect(queued).toHaveLength(1);
	});

	it('tells the account when a failed payment takes its access away', async () => {
		const session = await subscribedSession();
		const billing = provider();
		const seeded = billing.seedSubscription(`sub_${session.accountId}`, session.accountId);
		await deliver(
			billing.emit('subscription_activated', session.accountId, { subscription: seeded }),
		);
		await db`DELETE FROM outbox`;

		await deliver(
			billing.emit('subscription_updated', session.accountId, {
				subscription: { ...seeded, status: 'past_due' },
				occurredAt: new Date('2026-12-01T00:00:00.000Z'),
			}),
		).expect(200, { applied: true });

		const queued = await db`SELECT kind FROM outbox`;
		expect(queued.map((row) => row['kind'])).toEqual(['billing.access_revoked']);
	});

	it('refuses to resume an account that never subscribed', async () => {
		const session = await subscribedSession();

		const response = await request(app.getHttpServer())
			.post('/billing/subscription/resume')
			.set('Authorization', `Bearer ${session.accessToken}`)
			.expect(404);

		expect(response.body.code).toBe('NOT_FOUND');
	});

	it('refuses to resume without a token', async () => {
		await request(app.getHttpServer()).post('/billing/subscription/resume').expect(401);
	});

	describe('entitlements', () => {
		async function entitlementsOf(accessToken: string) {
			const response = await request(app.getHttpServer())
				.get('/entitlements')
				.set('Authorization', `Bearer ${accessToken}`)
				.expect(200);
			return response.body as { tier: string | null; entitlements: { capabilities: string[] } };
		}

		function activation(accountId: string, status: SubscriptionStatus = 'active') {
			const billing = provider();
			return billing.emit('subscription_activated', accountId, {
				subscription: { ...billing.seedSubscription(`sub_${accountId}`, accountId), status },
			});
		}

		function statusChange(accountId: string, status: SubscriptionStatus, at: string) {
			const billing = provider();
			return billing.emit('subscription_updated', accountId, {
				subscription: { ...billing.seedSubscription(`sub_${accountId}`, accountId), status },
				occurredAt: new Date(at),
			});
		}

		it('unlocks nothing for an account that never subscribed', async () => {
			const session = await subscribedSession();

			expect(await entitlementsOf(session.accessToken)).toEqual({
				tier: null,
				entitlements: UNSUBSCRIBED_ENTITLEMENTS,
			});
		});

		it('requires a token, since the answer is about one account', async () => {
			await request(app.getHttpServer()).get('/entitlements').expect(401);
		});

		it('grants the tier on the next request after the activation webhook', async () => {
			const session = await subscribedSession();
			expect((await entitlementsOf(session.accessToken)).tier).toBeNull();

			await deliver(activation(session.accountId)).expect(200, { applied: true });

			expect(await entitlementsOf(session.accessToken)).toEqual({
				tier: 'pro',
				entitlements: ENTITLEMENTS.pro,
			});
		});

		it('takes the tier away on the next request after the status goes past_due', async () => {
			const session = await subscribedSession();
			await deliver(activation(session.accountId)).expect(200, { applied: true });
			expect((await entitlementsOf(session.accessToken)).tier).toBe('pro');

			await deliver(statusChange(session.accountId, 'past_due', '2026-09-02T00:00:00.000Z')).expect(
				200,
				{ applied: true },
			);

			expect(await entitlementsOf(session.accessToken)).toEqual({
				tier: null,
				entitlements: UNSUBSCRIBED_ENTITLEMENTS,
			});
		});

		it('leaves the tier standing on a payment_failed, which carries no subscription', async () => {
			const session = await subscribedSession();
			await deliver(activation(session.accountId)).expect(200, { applied: true });
			expect((await entitlementsOf(session.accessToken)).tier).toBe('pro');

			const hook = provider().emit('payment_failed', session.accountId, {
				externalCustomerId: 'cus_e2e',
			});
			await deliver(hook).expect(200, { applied: true });

			expect((await entitlementsOf(session.accessToken)).tier).toBe('pro');
		});

		it('never serves one account the tier of another', async () => {
			const paid = await subscribedSession();
			const unpaid = await subscribedSession();

			await deliver(activation(paid.accountId)).expect(200, { applied: true });

			expect((await entitlementsOf(paid.accessToken)).tier).toBe('pro');
			expect((await entitlementsOf(unpaid.accessToken)).tier).toBeNull();
		});
	});

	describe('devices', () => {
		const PUBLIC_KEY = 'hAcCPVXqcJRVvi/JIn1jjnpUAxbfEbAJPBUlkAcO8k4=';

		function activation(accountId: string) {
			const billing = provider();
			return billing.emit('subscription_activated', accountId, {
				subscription: billing.seedSubscription(`sub_${accountId}`, accountId),
			});
		}

		async function subscribed() {
			const session = await subscribedSession();
			await deliver(activation(session.accountId)).expect(200, { applied: true });
			return session;
		}

		function createDevice(accessToken: string, publicKey = PUBLIC_KEY) {
			return request(app.getHttpServer())
				.post('/devices')
				.set('Authorization', `Bearer ${accessToken}`)
				.send({ name: 'laptop', publicKey });
		}

		// There is no endpoint that adds a user to an account yet, so the colleague
		// is inserted as system and given a token the same service issues.
		async function colleagueOf(accountId: string, role: 'admin' | 'member') {
			const email = freshEmail();
			const [user] = await db`
				INSERT INTO users (account_id, email, password_hash, role, email_verified_at)
				VALUES (${accountId}, ${email}, 'x', ${role}, now())
				RETURNING id
			`;
			const userId = (user as { id: string }).id;

			const accessToken = await app.get(AccessTokenService).issue({
				userId,
				accountId,
				role,
				sessionId: randomUUID(),
				emailVerified: true,
			});

			return { userId, email, accessToken };
		}

		it('answers 402 when the account never subscribed, which is the gate doing its job', async () => {
			const session = await subscribedSession();

			const response = await createDevice(session.accessToken).expect(402);
			expect(response.body.code).toBe('PAYMENT_REQUIRED');
		});

		it('refuses to list devices without the capability either', async () => {
			const session = await subscribedSession();

			await request(app.getHttpServer())
				.get('/devices')
				.set('Authorization', `Bearer ${session.accessToken}`)
				.expect(402);
		});

		it('creates a device once the subscription grants vpn_access', async () => {
			const session = await subscribed();

			const response = await createDevice(session.accessToken).expect(201);

			expect(response.body.device.publicKey).toBe(PUBLIC_KEY);
			expect(response.body.device.tunnelAddress).toMatch(/^10\.13\.13\.\d+\/32$/);
			expect(response.body.device.provisionedAt).toBeNull();
			expect(response.body.node.publicKey).toBeTruthy();
		});

		it('never accepts anything shaped like a private key', async () => {
			const session = await subscribed();

			const response = await createDevice(session.accessToken, 'not-a-key').expect(400);
			expect(response.body.fields.publicKey).toBe('validation.publicKey.invalid');
		});

		it('writes the provisioning intention in the same transaction as the row', async () => {
			const session = await subscribed();
			await createDevice(session.accessToken).expect(201);

			const rows = await db`SELECT kind FROM outbox WHERE kind = 'device.provision'`;
			expect(rows).toHaveLength(1);
		});

		it('gives two devices of one user different addresses', async () => {
			const session = await subscribed();
			const other = 'sVFHTBiVR0ndYPKZQBFsvHOJmxtfDppNwCPYSPTHZ0Y=';

			const first = await createDevice(session.accessToken).expect(201);
			const second = await createDevice(session.accessToken, other).expect(201);

			expect(second.body.device.tunnelAddress).not.toBe(first.body.device.tunnelAddress);
		});

		it('lists only the live devices, so a revoked one stops being offered', async () => {
			const session = await subscribed();
			const created = await createDevice(session.accessToken).expect(201);

			await request(app.getHttpServer())
				.delete(`/devices/${created.body.device.id}`)
				.set('Authorization', `Bearer ${session.accessToken}`)
				.expect(204);

			const listed = await request(app.getHttpServer())
				.get('/devices')
				.set('Authorization', `Bearer ${session.accessToken}`)
				.expect(200);

			expect(listed.body.devices).toHaveLength(0);
		});

		it('lets the same key come back after it was revoked', async () => {
			const session = await subscribed();
			const created = await createDevice(session.accessToken).expect(201);

			await request(app.getHttpServer())
				.delete(`/devices/${created.body.device.id}`)
				.set('Authorization', `Bearer ${session.accessToken}`)
				.expect(204);

			await createDevice(session.accessToken).expect(201);
		});

		it('names the duplicate key rather than blaming the address range', async () => {
			const session = await subscribed();
			await createDevice(session.accessToken).expect(201);

			const second = await createDevice(session.accessToken).expect(409);

			expect(second.body.message).toContain('public key');
		});

		it('names the duplicate key even when the live device belongs to another account', async () => {
			const first = await subscribed();
			await createDevice(first.accessToken).expect(201);

			const second = await subscribed();
			const response = await createDevice(second.accessToken).expect(409);

			expect(response.body.message).toContain('public key');
		});

		it('refuses to revoke a device that belongs to another member', async () => {
			const owner = await subscribed();
			const created = await createDevice(owner.accessToken).expect(201);
			const colleague = await colleagueOf(owner.accountId, 'member');

			await request(app.getHttpServer())
				.delete(`/devices/${created.body.device.id}`)
				.set('Authorization', `Bearer ${colleague.accessToken}`)
				.expect(404);

			const [row] = await db`SELECT revoked_at FROM devices WHERE id = ${created.body.device.id}`;
			expect((row as { revoked_at: Date | null }).revoked_at).toBeNull();
		});

		it('lets an admin revoke a device that is not theirs, which is what offboarding needs', async () => {
			const owner = await subscribed();
			const created = await createDevice(owner.accessToken).expect(201);
			const admin = await colleagueOf(owner.accountId, 'admin');

			await request(app.getHttpServer())
				.delete(`/devices/${created.body.device.id}`)
				.set('Authorization', `Bearer ${admin.accessToken}`)
				.expect(204);

			const [row] = await db`SELECT revoked_at FROM devices WHERE id = ${created.body.device.id}`;
			expect((row as { revoked_at: Date | null }).revoked_at).not.toBeNull();
		});

		it('tells the node to forget a peer an admin revoked', async () => {
			const owner = await subscribed();
			const created = await createDevice(owner.accessToken).expect(201);
			const admin = await colleagueOf(owner.accountId, 'admin');

			await request(app.getHttpServer())
				.delete(`/devices/${created.body.device.id}`)
				.set('Authorization', `Bearer ${admin.accessToken}`)
				.expect(204);

			const rows = await db`SELECT payload FROM outbox WHERE kind = 'device.revoke'`;
			expect(rows).toHaveLength(1);
			expect((rows[0] as { payload: { publicKey: string } }).payload.publicKey).toBe(PUBLIC_KEY);
		});

		it('answers 404 for revoking a device that is already gone', async () => {
			const session = await subscribed();
			const created = await createDevice(session.accessToken).expect(201);
			const url = `/devices/${created.body.device.id}`;

			await request(app.getHttpServer())
				.delete(url)
				.set('Authorization', `Bearer ${session.accessToken}`)
				.expect(204);

			await request(app.getHttpServer())
				.delete(url)
				.set('Authorization', `Bearer ${session.accessToken}`)
				.expect(404);
		});
	});
});

describe('locale', () => {
	it('mails in pt-BR when no Accept-Language is given', async () => {
		const email = freshEmail();
		await request(app.getHttpServer())
			.post('/auth/register')
			.send({ email, password: PASSWORD })
			.expect(202);

		expect((await latestMessageFor(email)).subject).toBe('Confirme seu e-mail');
	});

	it('mails in English when Accept-Language asks for it', async () => {
		const email = freshEmail();
		await request(app.getHttpServer())
			.post('/auth/register')
			.set('Accept-Language', 'en-GB,en;q=0.9')
			.send({ email, password: PASSWORD })
			.expect(202);

		expect((await latestMessageFor(email)).subject).toBe('Confirm your e-mail');
	});

	it('honours an explicit locale in the body over the header', async () => {
		const email = freshEmail();
		await request(app.getHttpServer())
			.post('/auth/register')
			.set('Accept-Language', 'pt-BR')
			.send({ email, password: PASSWORD, locale: 'en' })
			.expect(202);

		expect((await latestMessageFor(email)).subject).toBe('Confirm your e-mail');
	});

	it('reports the negotiated locale back on the response', async () => {
		const response = await request(app.getHttpServer())
			.get('/health')
			.set('Accept-Language', 'en')
			.expect(200);

		expect(response.headers['content-language']).toBe('en');
	});

	it('falls back for a language we do not carry', async () => {
		const response = await request(app.getHttpServer())
			.get('/health')
			.set('Accept-Language', 'fr-FR')
			.expect(200);

		expect(response.headers['content-language']).toBe('pt-BR');
	});

	it('exposes the account locale on /auth/me', async () => {
		const email = freshEmail();
		await registerAndVerify(email);
		const login = await loginFor(email);

		const me = await request(app.getHttpServer())
			.get('/auth/me')
			.set('Authorization', `Bearer ${login.body.accessToken}`)
			.expect(200);

		expect(me.body.locale).toBe('pt-BR');
	});

	it('changes the account locale', async () => {
		const email = freshEmail();
		await registerAndVerify(email);
		const login = await loginFor(email);

		const updated = await request(app.getHttpServer())
			.patch('/auth/me/locale')
			.set('Authorization', `Bearer ${login.body.accessToken}`)
			.send({ locale: 'en' })
			.expect(200);

		expect(updated.body.locale).toBe('en');
	});

	it('rejects a locale we do not support, with an i18n key', async () => {
		const email = freshEmail();
		await registerAndVerify(email);
		const login = await loginFor(email);

		const response = await request(app.getHttpServer())
			.patch('/auth/me/locale')
			.set('Authorization', `Bearer ${login.body.accessToken}`)
			.send({ locale: 'klingon' })
			.expect(400);

		expect(response.body.code).toBe('VALIDATION_FAILED');
		expect(response.body.fields.locale).toBe('validation.locale.unsupported');
	});

	it('mails in the account locale even when the header disagrees', async () => {
		const email = freshEmail();
		await registerAndVerify(email);
		const login = await loginFor(email);

		await request(app.getHttpServer())
			.patch('/auth/me/locale')
			.set('Authorization', `Bearer ${login.body.accessToken}`)
			.send({ locale: 'en' })
			.expect(200);

		await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
		await request(app.getHttpServer())
			.post('/auth/forgot-password')
			.set('Accept-Language', 'pt-BR')
			.send({ email })
			.expect(202);

		expect((await latestMessageFor(email)).subject).toBe('Password reset');
	});

	it('returns a validation failure as an i18n key, not as prose', async () => {
		const response = await request(app.getHttpServer())
			.post('/auth/register')
			.send({ email: freshEmail(), password: 'short' })
			.expect(400);

		expect(response.body.fields.password).toBe('validation.password.tooShort');
	});
});

describe('queued notifications', () => {
	it('answers the registration without the mail server on the path', async () => {
		const email = freshEmail();

		await request(app.getHttpServer())
			.post('/auth/register')
			.send({ email, password: PASSWORD })
			.expect(202);

		const pending = await db`SELECT kind FROM outbox WHERE published_at IS NULL`;
		expect(pending).toHaveLength(1);
		expect(pending[0]?.['kind']).toBe('auth.verification');
		expect(await mailpitCount()).toBe(0);
	});

	it('never writes a token into the outbox payload', async () => {
		const email = freshEmail();
		await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });
		await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });

		const rows = await db`SELECT payload::text AS payload FROM outbox`;
		const token = await tokenFromMail(email);

		expect(rows.length).toBeGreaterThan(0);
		for (const row of rows) {
			const payload = String(row['payload']);
			expect(payload).not.toContain(token);
			expect(Object.keys(JSON.parse(payload) as object).sort()).toEqual(['kind', 'userId']);
		}
	});

	it('marks a relayed row published, so a second relay does not enqueue it twice', async () => {
		const email = freshEmail();
		await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });

		expect(await app.get(OutboxRelay).runOnce()).toBe(1);
		expect(await app.get(OutboxRelay).runOnce()).toBe(0);

		const unpublished = await db`SELECT id FROM outbox WHERE published_at IS NULL`;
		expect(unpublished).toHaveLength(0);
	});

	it('does not hand the same row to two relays running at once', async () => {
		const emails = Array.from({ length: 12 }, () => freshEmail());
		for (const email of emails) {
			await request(app.getHttpServer())
				.post('/auth/register')
				.send({ email, password: PASSWORD })
				.expect(202);
		}

		const relay = app.get(OutboxRelay);
		const counts = await Promise.all([relay.runOnce(), relay.runOnce(), relay.runOnce()]);

		expect(counts.reduce((total, count) => total + count, 0)).toBe(emails.length);

		const published =
			await db`SELECT count(*)::int AS count FROM outbox WHERE published_at IS NOT NULL`;
		expect(published[0]?.['count']).toBe(emails.length);
	});

	it('delivers one e-mail even when the consumer runs twice over the same job', async () => {
		const email = freshEmail();
		await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });

		await app.get(OutboxRelay).runOnce();
		await app.get(OutboxConsumer).runOnce();
		await app.get(OutboxConsumer).runOnce();

		expect(await mailpitCount()).toBe(1);
	});

	it('leaves nothing behind when the registration transaction fails', async () => {
		const email = freshEmail();
		const outbox = app.get(OutboxRepository);
		const enqueue = vi
			.spyOn(outbox, 'enqueue')
			.mockRejectedValueOnce(new Error('outbox unavailable'));

		try {
			await request(app.getHttpServer())
				.post('/auth/register')
				.send({ email, password: PASSWORD })
				.expect(500);
		} finally {
			enqueue.mockRestore();
		}

		expect(await db`SELECT id FROM users WHERE email = ${email}`).toHaveLength(0);
		expect(await db`SELECT id FROM outbox`).toHaveLength(0);
	});

	it('keeps both writes when the registration transaction commits', async () => {
		const email = freshEmail();

		await request(app.getHttpServer())
			.post('/auth/register')
			.send({ email, password: PASSWORD })
			.expect(202);

		expect(await db`SELECT id FROM users WHERE email = ${email}`).toHaveLength(1);
		expect(await db`SELECT id FROM outbox`).toHaveLength(1);
	});

	it('mails the user when the job and the row agree on the account', async () => {
		const { userId, accountId } = await registeredUser();
		await queueWelcome(accountId, userId);

		await drainNotifications();

		expect(await mailpitCount()).toBe(1);
	});

	it('mails nobody when the job names a user of another account', async () => {
		const { userId } = await registeredUser();
		const stranger = await registeredUser();
		await queueWelcome(stranger.accountId, userId);

		await drainNotifications();

		expect(await mailpitCount()).toBe(0);
	});
});

describe('cross-cutting', () => {
	it('reports liveness without touching a dependency', async () => {
		await request(app.getHttpServer()).get('/health').expect(200);
	});

	it('reports readiness with a per-dependency breakdown', async () => {
		const response = await request(app.getHttpServer()).get('/health/ready').expect(200);
		expect(response.body).toMatchObject({
			status: 'ok',
			details: { database: { status: 'up' }, cache: { status: 'up' } },
		});
	});

	it('echoes a correlation id the caller supplied', async () => {
		const response = await request(app.getHttpServer())
			.get('/health')
			.set('x-correlation-id', 'given-by-the-client')
			.expect(200);
		expect(response.headers['x-correlation-id']).toBe('given-by-the-client');
	});

	it('mints a correlation id when the caller did not', async () => {
		const response = await request(app.getHttpServer()).get('/health').expect(200);
		expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
	});

	it('puts the correlation id on an error body too', async () => {
		const response = await request(app.getHttpServer()).get('/auth/me').expect(401);
		expect(response.body.correlationId).toBeTruthy();
	});
});
