import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '@vpn-poc/env';
import type { Account } from '@vpn/ports';
import { MemoryEmailSender } from '@vpn/testing/fakes';

import { runWithContext } from '../../../shared/http/request-context.js';
import { BillingMailer } from './billing-mailer.service.js';

const env = { WEB_ORIGIN: 'https://app.example.com' } as Env;

function account(overrides: Partial<Account> = {}): Account {
	return {
		id: 'acc-1',
		email: 'ada@example.com',
		locale: 'pt-BR',
		emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	} as Account;
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

	it('mails a cancellation in the locale of the account', async () => {
		await mailer.sendSubscriptionCanceled(account({ locale: 'en' }), new Date(), 'evt-2');

		expect(email.sent[0]?.locale).toBe('en');
	});

	it('prefers the account locale over the locale negotiated for the request', async () => {
		await runWithContext({ correlationId: 'c', locale: 'en', module: 'system' }, async () => {
			await mailer.sendPaymentFailed(account({ locale: 'pt-BR' }), 'evt-3');
		});

		expect(email.sent[0]?.locale).toBe('pt-BR');
	});

	it('renders a known period end as an ISO timestamp', async () => {
		const endsAt = new Date('2026-09-01T00:00:00.000Z');
		await mailer.sendSubscriptionCanceled(account(), endsAt, 'evt-4');

		expect(email.sent[0]?.variables['endsAt']).toBe('2026-09-01T00:00:00.000Z');
	});

	it('translates an unknown period end instead of hardcoding a phrase', async () => {
		await mailer.sendSubscriptionCanceled(account({ locale: 'en' }), null, 'evt-5');

		expect(email.sent[0]?.variables['endsAt']).toBe('the end of the current period');
	});

	it('translates the unknown period end per locale', async () => {
		await mailer.sendSubscriptionCanceled(account({ locale: 'pt-BR' }), null, 'evt-6');

		expect(email.sent[0]?.variables['endsAt']).toBe('o fim do período vigente');
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
