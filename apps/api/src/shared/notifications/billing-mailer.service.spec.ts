import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '@vpn-poc/env';
import type { User } from '../identity/user.js';
import { MemoryEmailSender } from '@vpn/testing/fakes';

import { runWithContext } from '../http/request-context.js';
import { BillingMailer } from './billing-mailer.service.js';

const env = { WEB_ORIGIN: 'https://app.example.com' } as Env;

const REQUESTED_AT = new Date('2026-05-01T00:00:00.000Z');

function account(overrides: Partial<User> = {}): User {
	return {
		id: 'acc-1',
		email: 'ada@example.com',
		locale: 'pt-BR',
		emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	} as User;
}

describe('BillingMailer', () => {
	let email: MemoryEmailSender;
	let mailer: BillingMailer;

	beforeEach(() => {
		email = new MemoryEmailSender();
		mailer = new BillingMailer(email, env);
	});

	it('mails a payment failure in the locale of the account, not a fixed one', async () => {
		await mailer.sendPaymentFailed(account({ locale: 'en' }), 'evt-1');

		expect(email.sent[0]?.locale).toBe('en');
	});

	it('mails an activation in the locale of the account', async () => {
		await mailer.sendSubscriptionActivated(account({ locale: 'en' }), 'evt-a');

		expect(email.sent[0]?.locale).toBe('en');
		expect(email.sent[0]?.template).toBe('subscription_activated');
	});

	it('points the activation at the billing page', async () => {
		await mailer.sendSubscriptionActivated(account(), 'evt-b');

		expect(email.sent[0]?.variables['url']).toBe('https://app.example.com/billing');
	});

	it('keys the activation on its own event, so it cannot collide with a failure', async () => {
		await mailer.sendSubscriptionActivated(account(), 'evt-c');
		await mailer.sendPaymentFailed(account(), 'evt-c');

		expect(email.sent).toHaveLength(2);
	});

	it('mails a cancellation in the locale of the account', async () => {
		await mailer.sendSubscriptionCanceled(account({ locale: 'en' }), 'evt-2');

		expect(email.sent[0]?.locale).toBe('en');
	});

	it('prefers the account locale over the locale negotiated for the request', async () => {
		await runWithContext(
			{ correlationId: 'c', locale: 'en', module: 'system', ip: null, tenant: null },
			async () => {
				await mailer.sendPaymentFailed(account({ locale: 'pt-BR' }), 'evt-3');
			},
		);

		expect(email.sent[0]?.locale).toBe('pt-BR');
	});

	it('renders a known period end as an ISO timestamp', async () => {
		const endsAt = new Date('2026-09-01T00:00:00.000Z');
		await mailer.sendCancellationScheduled(account(), endsAt, REQUESTED_AT);

		expect(email.sent[0]?.variables['endsAt']).toBe('2026-09-01T00:00:00.000Z');
	});

	it('translates an unknown period end instead of hardcoding a phrase', async () => {
		await mailer.sendCancellationScheduled(account({ locale: 'en' }), null, REQUESTED_AT);

		expect(email.sent[0]?.variables['endsAt']).toBe('the end of the current period');
	});

	it('translates the unknown period end per locale', async () => {
		await mailer.sendCancellationScheduled(account({ locale: 'pt-BR' }), null, REQUESTED_AT);

		expect(email.sent[0]?.variables['endsAt']).toBe('o fim do período vigente');
	});

	it('points every billing mail at a page the reader can act on', async () => {
		await mailer.sendCancellationScheduled(account(), null, REQUESTED_AT);
		await mailer.sendSubscriptionResumed(account(), REQUESTED_AT);
		await mailer.sendSubscriptionCanceled(account(), 'evt-u');
		await mailer.sendAccessRevoked(account(), 'evt-v');

		for (const sent of email.sent) {
			expect(sent.variables['url']).toBe('https://app.example.com/billing');
		}
	});

	it('keys a scheduled cancellation apart from a resume made at the same instant', async () => {
		await mailer.sendCancellationScheduled(account(), null, REQUESTED_AT);
		await mailer.sendSubscriptionResumed(account(), REQUESTED_AT);

		expect(email.sent).toHaveLength(2);
	});

	it('sends one mail when the relay retries the same scheduled cancellation', async () => {
		await mailer.sendCancellationScheduled(account(), null, REQUESTED_AT);
		await mailer.sendCancellationScheduled(account(), null, REQUESTED_AT);

		expect(email.sent).toHaveLength(1);
	});

	it('sends again when the same account cancels a second time, later', async () => {
		await mailer.sendCancellationScheduled(account(), null, REQUESTED_AT);
		await mailer.sendCancellationScheduled(account(), null, new Date('2026-05-02T00:00:00.000Z'));

		expect(email.sent).toHaveLength(2);
	});

	it('tells the account that lost access what to do about it', async () => {
		await mailer.sendAccessRevoked(account({ locale: 'en' }), 'evt-w');

		expect(email.sent[0]?.template).toBe('access_revoked');
		expect(email.sent[0]?.locale).toBe('en');
	});

	it('points the payment failure at the billing page', async () => {
		await mailer.sendPaymentFailed(account(), 'evt-7');

		expect(email.sent[0]?.variables['url']).toBe('https://app.example.com/billing');
	});

	it('keys each mail on the event, so a redelivery cannot send twice', async () => {
		await mailer.sendPaymentFailed(account(), 'evt-8');
		await mailer.sendPaymentFailed(account(), 'evt-8');

		expect(email.sent).toHaveLength(1);
	});
});
