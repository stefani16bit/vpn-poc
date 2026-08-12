import { describe, expect, it } from 'vitest';

import { StripeBillingProvider } from './StripeBillingProvider.js';

const ACCOUNT = 'afe9453a-81ae-481d-a678-f81ef6f149ef';
const PERIOD_END = 1786310000;

const provider = new StripeBillingProvider({
	apiKey: 'sk_test_unit',
	webhookSecret: 'whsec_unit',
});

function event(type: string, object: unknown): string {
	return JSON.stringify({ id: 'evt_1', type, created: 1786300000, data: { object } });
}

const ACACIA_SUBSCRIPTION = {
	id: 'sub_1',
	object: 'subscription',
	customer: 'cus_1',
	status: 'active',
	cancel_at_period_end: false,
	current_period_end: PERIOD_END,
	metadata: { account_id: ACCOUNT },
	items: { object: 'list', data: [{ id: 'si_1', object: 'subscription_item' }] },
};

const DAHLIA_SUBSCRIPTION = {
	id: 'sub_1',
	object: 'subscription',
	customer: 'cus_1',
	status: 'active',
	cancel_at_period_end: false,
	metadata: { account_id: ACCOUNT },
	items: {
		object: 'list',
		data: [{ id: 'si_1', object: 'subscription_item', current_period_end: PERIOD_END }],
	},
};

const ISSUED_AT = 1786299000;

const ACACIA_INVOICE = {
	id: 'in_1',
	object: 'invoice',
	customer: 'cus_1',
	number: 'ACC-0001',
	currency: 'brl',
	amount_due: 4900,
	amount_paid: 4900,
	created: ISSUED_AT,
	subscription_details: { metadata: { account_id: ACCOUNT } },
};

const DAHLIA_INVOICE = {
	id: 'in_1',
	object: 'invoice',
	customer: 'cus_1',
	number: 'ACC-0001',
	currency: 'brl',
	amount_due: 4900,
	amount_paid: 4900,
	created: ISSUED_AT,
	parent: { subscription_details: { metadata: { account_id: ACCOUNT } } },
};

describe('parseWebhookEvent across API versions', () => {
	it('reads the period end where 2025-02-24.acacia puts it', () => {
		const parsed = provider.parseWebhookEvent(
			event('customer.subscription.created', ACACIA_SUBSCRIPTION),
		);

		expect(parsed).toMatchObject({
			kind: 'subscription_activated',
			accountId: ACCOUNT,
			subscription: { currentPeriodEnd: new Date(PERIOD_END * 1000) },
		});
	});

	it('reads the period end off the item, where 2026-04-22.dahlia moved it', () => {
		const parsed = provider.parseWebhookEvent(
			event('customer.subscription.created', DAHLIA_SUBSCRIPTION),
		);

		expect(parsed).toMatchObject({
			kind: 'subscription_activated',
			accountId: ACCOUNT,
			subscription: { currentPeriodEnd: new Date(PERIOD_END * 1000) },
		});
	});

	it('reports no period end when neither shape carries one', () => {
		const parsed = provider.parseWebhookEvent(
			event('customer.subscription.created', {
				...DAHLIA_SUBSCRIPTION,
				items: { object: 'list', data: [] },
			}),
		);

		expect(parsed).toMatchObject({ subscription: { currentPeriodEnd: null } });
	});

	it('finds the account of a failed payment where acacia puts it', () => {
		const parsed = provider.parseWebhookEvent(event('invoice.payment_failed', ACACIA_INVOICE));

		expect(parsed).toMatchObject({ kind: 'payment_failed', accountId: ACCOUNT });
	});

	it('finds it under invoice.parent, where dahlia moved it', () => {
		const parsed = provider.parseWebhookEvent(event('invoice.payment_failed', DAHLIA_INVOICE));

		expect(parsed).toMatchObject({ kind: 'payment_failed', accountId: ACCOUNT });
	});

	it('ignores an invoice belonging to no subscription of ours', () => {
		const parsed = provider.parseWebhookEvent(
			event('invoice.payment_failed', { id: 'in_1', object: 'invoice', customer: 'cus_1' }),
		);

		expect(parsed).toBeNull();
	});

	it('carries the invoice on a failed payment, in either shape', () => {
		for (const invoice of [ACACIA_INVOICE, DAHLIA_INVOICE]) {
			const parsed = provider.parseWebhookEvent(event('invoice.payment_failed', invoice));

			expect(parsed).toMatchObject({
				kind: 'payment_failed',
				invoice: {
					externalId: 'in_1',
					number: 'ACC-0001',
					status: 'failed',
					amountCents: 4900,
					currency: 'brl',
					issuedAt: new Date(ISSUED_AT * 1000),
				},
			});
		}
	});

	it('normalises a paid invoice, in either shape', () => {
		for (const invoice of [ACACIA_INVOICE, DAHLIA_INVOICE]) {
			const parsed = provider.parseWebhookEvent(event('invoice.paid', invoice));

			expect(parsed).toMatchObject({
				kind: 'invoice_paid',
				accountId: ACCOUNT,
				invoice: { externalId: 'in_1', status: 'paid', amountCents: 4900 },
			});
		}
	});

	// A failed charge has amount_paid at zero, and a statement line reading R$ 0
	// would say the opposite of what happened.
	it('reads the amount from what was paid, or from what was due when it was not', () => {
		const failed = provider.parseWebhookEvent(
			event('invoice.payment_failed', { ...ACACIA_INVOICE, amount_paid: 0 }),
		);

		expect(failed).toMatchObject({ invoice: { amountCents: 4900 } });
	});

	it('ignores a paid invoice belonging to no subscription of ours', () => {
		const parsed = provider.parseWebhookEvent(
			event('invoice.paid', { id: 'in_1', object: 'invoice', customer: 'cus_1' }),
		);

		expect(parsed).toBeNull();
	});

	it('trusts the status over the event name, in either shape', () => {
		for (const subscription of [ACACIA_SUBSCRIPTION, DAHLIA_SUBSCRIPTION]) {
			const parsed = provider.parseWebhookEvent(
				event('customer.subscription.updated', { ...subscription, status: 'canceled' }),
			);

			expect(parsed).toMatchObject({ kind: 'subscription_canceled' });
		}
	});
});
