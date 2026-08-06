import { MAILPIT_URL } from './e2e.setup.js';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DATABASE_CONNECTION } from '@vpn-poc/adapters';
import { BILLING_PROVIDER } from '@vpn/ports';
import type { MemoryBillingProvider } from '@vpn/testing/fakes';

import type { createDatabase } from '@vpn-poc/database';

import { createApp } from './bootstrap.js';

let app: INestApplication;
let sql: ReturnType<typeof createDatabase>['sql'];

const PASSWORD = 'a-sufficiently-long-password';
const NEW_PASSWORD = 'an-entirely-different-password';

beforeAll(async () => {
	app = await createApp();
	await app.init();
	sql = (app.get(DATABASE_CONNECTION) as { sql: typeof sql }).sql;
});

afterAll(async () => {
	await app.close();
});

beforeEach(async () => {
	await sql`DELETE FROM accounts`;
	await sql`DELETE FROM billing_events`;
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

async function inbox(): Promise<readonly MailpitSummary[]> {
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

		await request(app.getHttpServer())
			.post('/auth/refresh')
			.set('Cookie', legitimate)
			.expect(401);
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
			await request(app.getHttpServer())
				.post('/auth/forgot-password')
				.send({ email })
				.expect(202);
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
		return { email, accessToken: login.body.accessToken as string, accountId: login.body.user.id as string };
	}

	it('creates a checkout session', async () => {
		const session = await subscribedSession();

		const response = await request(app.getHttpServer())
			.post('/billing/checkout')
			.set('Authorization', `Bearer ${session.accessToken}`)
			.send({ plan: 'monthly' })
			.expect(200);

		expect(response.body.checkoutUrl).toContain('price_local_monthly');
	});

	it('returns the same checkout for a repeated request', async () => {
		const session = await subscribedSession();
		const send = () =>
			request(app.getHttpServer())
				.post('/billing/checkout')
				.set('Authorization', `Bearer ${session.accessToken}`)
				.send({ plan: 'monthly' });

		const [first, second] = [await send(), await send()];
		expect(second.body.checkoutUrl).toBe(first.body.checkoutUrl);
	});

	it('requires authentication to start a checkout', async () => {
		await request(app.getHttpServer())
			.post('/billing/checkout')
			.send({ plan: 'monthly' })
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

		const ledger = await sql`SELECT count(*)::int AS count FROM billing_events`;
		expect(ledger[0]?.['count']).toBe(1);
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
