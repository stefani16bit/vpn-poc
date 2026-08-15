import Stripe from 'stripe';
import { beforeAll, describe, expect, it } from 'vitest';

import {
	describeBillingLifecycleContract,
	describeBillingWebhookContract,
	type SignedWebhook,
} from '@vpn/testing/contracts';

import { INTEGRATION } from '../integration.env.js';
import { StripeBillingProvider } from './StripeBillingProvider.js';

const PLAN_ID = 'price_local_monthly';
const PRODUCT_ID = 'prod_pocvpn_it';

const provider = new StripeBillingProvider({
	apiKey: INTEGRATION.stripeApiKey,
	webhookSecrets: [INTEGRATION.stripeWebhookSecret],
	apiBase: INTEGRATION.stripeApiBase,
});

async function ensurePlan(): Promise<void> {
	await postForm('/v1/products', { id: PRODUCT_ID, name: 'poc-vpn integration' }).catch(() => {});
	await postForm('/v1/plans', {
		id: PLAN_ID,
		amount: '2990',
		currency: 'brl',
		interval: 'month',
		product: PRODUCT_ID,
	}).catch(() => {});
}

async function postForm(path: string, body: Record<string, string>): Promise<unknown> {
	const response = await fetch(`${INTEGRATION.stripeApiBase}${path}`, {
		method: 'POST',
		headers: {
			Authorization: `Basic ${Buffer.from(`${INTEGRATION.stripeApiKey}:`).toString('base64')}`,
			'Content-Type': 'application/x-www-form-urlencoded',
		},
		body: new URLSearchParams(body).toString(),
	});
	const payload = await response.json();
	if (!response.ok) throw new Error(`${path}: ${JSON.stringify(payload)}`);
	return payload;
}

async function createLiveSubscription(accountId: string): Promise<string> {
	const customer = (await postForm('/v1/customers', { email: `${accountId}@example.com` })) as {
		id: string;
	};

	const method = (await postForm('/v1/payment_methods', {
		type: 'card',
		'card[number]': '4242424242424242',
		'card[exp_month]': '12',
		'card[exp_year]': '2030',
		'card[cvc]': '123',
	})) as { id: string };

	await postForm(`/v1/payment_methods/${method.id}/attach`, { customer: customer.id });
	await postForm(`/v1/customers/${customer.id}`, {
		'invoice_settings[default_payment_method]': method.id,
	});

	const subscription = (await postForm('/v1/subscriptions', {
		customer: customer.id,
		'items[0][plan]': PLAN_ID,
		'metadata[account_id]': accountId,
	})) as { id: string };

	return subscription.id;
}

const secret = INTEGRATION.stripeWebhookSecret;

function signedEvent(event: Record<string, unknown>): { rawBody: string; signature: string } {
	const rawBody = JSON.stringify(event);
	return {
		rawBody,
		signature: Stripe.webhooks.generateTestHeaderString({ payload: rawBody, secret }),
	};
}

function subscriptionEvent(
	type: string,
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		id: `evt_${Math.random().toString(36).slice(2)}`,
		type,
		created: 1_790_000_000,
		data: {
			object: {
				id: 'sub_123',
				customer: 'cus_123',
				status: 'active',
				current_period_end: 1_800_000_000,
				cancel_at_period_end: false,
				metadata: { account_id: 'acct-1' },
				...overrides,
			},
		},
	};
}

// Hand-built and hand-signed, because localstripe emits no webhooks at all. That
// is not a gap in the coverage: verification and parsing are pure, so a fixture
// signed with the real SDK exercises exactly the code a delivery would.
function invoiceEvent(
	type: string,
	accountId: string,
	overrides: Record<string, unknown>,
): Record<string, unknown> {
	return {
		id: `evt_${Math.random().toString(36).slice(2)}`,
		type,
		created: 1_790_000_100,
		data: {
			object: {
				id: `in_${accountId}_${type.replace(/\W/g, '_')}`,
				customer: 'cus_123',
				number: 'A-0001',
				currency: 'brl',
				created: 1_790_000_100,
				subscription_details: { metadata: { account_id: accountId } },
				...overrides,
			},
		},
	};
}

// The two suites Stripe can face. Checkout is absent because localstripe has no
// /v1/checkout/sessions, and the invoice archive is absent because nothing it
// serves carries an invoice_pdf — both measured, both named in DEC-104, and
// neither skipped in silence inside a suite that then claims to have passed.
describeBillingLifecycleContract('StripeBillingProvider', () => ({
	provider,
	activeSubscription: (accountId) => createLiveSubscription(accountId),
}));

describeBillingWebhookContract('StripeBillingProvider', () => {
	let emitted = 0;

	function sign(event: Record<string, unknown>): SignedWebhook {
		// Stepped forward per call so two activations are orderable, which is what
		// the contract asks of occurredAt.
		const stamped: Record<string, unknown> = {
			...event,
			created: 1_790_000_000 + (emitted += 1),
		};
		const { rawBody, signature } = signedEvent(stamped);

		return { rawBody, signature, eventId: stamped['id'] as string };
	}

	return {
		provider,
		activationWebhook: (accountId) =>
			sign(
				subscriptionEvent('customer.subscription.created', { metadata: { account_id: accountId } }),
			),
		unknownEventWebhook: () => sign(subscriptionEvent('invoice.upcoming')),
		paidInvoiceWebhook: (accountId) =>
			sign(invoiceEvent('invoice.paid', accountId, { amount_paid: 2990, amount_due: 2990 })),
		failedInvoiceWebhook: (accountId) =>
			sign(invoiceEvent('invoice.payment_failed', accountId, { amount_paid: 0, amount_due: 2990 })),
	};
});

describe('StripeBillingProvider webhook handling (pure)', () => {
	it('accepts a correctly signed body', () => {
		const { rawBody, signature } = signedEvent(subscriptionEvent('customer.subscription.created'));
		expect(provider.verifyWebhookSignature(rawBody, signature)).toBe(true);
	});

	it('rejects a body that was modified after signing', () => {
		const { rawBody, signature } = signedEvent(subscriptionEvent('customer.subscription.created'));
		const tampered = rawBody.replace('acct-1', 'acct-attacker');
		expect(provider.verifyWebhookSignature(tampered, signature)).toBe(false);
	});

	it('rejects a signature made with a different secret', () => {
		const rawBody = JSON.stringify(subscriptionEvent('customer.subscription.created'));
		const foreign = Stripe.webhooks.generateTestHeaderString({
			payload: rawBody,
			secret: 'whsec_someone_elses',
		});
		expect(provider.verifyWebhookSignature(rawBody, foreign)).toBe(false);
	});

	it('rejects an empty signature header', () => {
		const { rawBody } = signedEvent(subscriptionEvent('customer.subscription.created'));
		expect(provider.verifyWebhookSignature(rawBody, '')).toBe(false);
	});

	it('rejects a signature whose timestamp is outside the tolerance', () => {
		const rawBody = JSON.stringify(subscriptionEvent('customer.subscription.created'));
		const stale = Stripe.webhooks.generateTestHeaderString({
			payload: rawBody,
			secret: INTEGRATION.stripeWebhookSecret,
			timestamp: Math.floor(Date.now() / 1000) - 3600,
		});
		expect(provider.verifyWebhookSignature(rawBody, stale)).toBe(false);
	});

	it('normalises a created subscription into an activation', () => {
		const rawBody = JSON.stringify(subscriptionEvent('customer.subscription.created'));
		const event = provider.parseWebhookEvent(rawBody);

		expect(event).toMatchObject({
			kind: 'subscription_activated',
			accountId: 'acct-1',
			subscription: { externalId: 'sub_123', status: 'active', cancelAtPeriodEnd: false },
		});
	});

	it('carries the event id so the caller can deduplicate redeliveries', () => {
		const raw = subscriptionEvent('customer.subscription.created');
		const event = provider.parseWebhookEvent(JSON.stringify(raw));
		expect(event?.externalEventId).toBe(raw['id']);
	});

	it('treats an updated-but-canceled subscription as a cancellation', () => {
		const rawBody = JSON.stringify(
			subscriptionEvent('customer.subscription.updated', { status: 'canceled' }),
		);
		expect(provider.parseWebhookEvent(rawBody)?.kind).toBe('subscription_canceled');
	});

	it('maps unpaid to past_due, because both mean "billed and not paid"', () => {
		const rawBody = JSON.stringify(
			subscriptionEvent('customer.subscription.updated', { status: 'unpaid' }),
		);
		const event = provider.parseWebhookEvent(rawBody);
		expect(event?.kind === 'subscription_updated' && event.subscription.status).toBe('past_due');
	});

	it('collapses incomplete_expired into incomplete, which means "not entitled"', () => {
		const rawBody = JSON.stringify(
			subscriptionEvent('customer.subscription.updated', { status: 'incomplete_expired' }),
		);
		const event = provider.parseWebhookEvent(rawBody);
		expect(event?.kind === 'subscription_updated' && event.subscription.status).toBe('incomplete');
	});

	it('ignores an event type this system does not model', () => {
		const rawBody = JSON.stringify({ id: 'evt_x', type: 'invoice.upcoming', data: { object: {} } });
		expect(provider.parseWebhookEvent(rawBody)).toBeNull();
	});

	it('ignores a subscription event with no account metadata', () => {
		const rawBody = JSON.stringify(
			subscriptionEvent('customer.subscription.created', { metadata: {} }),
		);
		expect(provider.parseWebhookEvent(rawBody)).toBeNull();
	});

	it('throws rather than returning null for an unparseable body', () => {
		expect(() => provider.parseWebhookEvent('<html>502</html>')).toThrow();
	});
});

// What is left here is what the lifecycle contract does not assert. Cancel at
// period end and resume moved into it — they were pinned by hand only because
// the suite could not be registered, and DEC-104 removed that reason.
describe('StripeBillingProvider against localstripe', () => {
	beforeAll(ensurePlan);

	// The contract only compares a read-back against what the write returned. This
	// asserts the shape of a read on its own, against a real wire payload: the
	// external id round-trips and the period end is revived rather than left as
	// the integer the API sent.
	it('reads a subscription back', async () => {
		const subscriptionId = await createLiveSubscription('acct-read');

		const subscription = await provider.getSubscription(subscriptionId);
		expect(subscription).toMatchObject({ externalId: subscriptionId, status: 'active' });
		expect(subscription?.currentPeriodEnd).toBeInstanceOf(Date);
	});

	it('returns null for a subscription that does not exist', async () => {
		await expect(provider.getSubscription('sub_does_not_exist')).resolves.toBeNull();
	});

	// Resuming leaves the period alone, which the contract has no way to ask for:
	// the fake is free to invent a period and a real provider is not.
	it('undoes a scheduled cancellation without touching the period', async () => {
		const subscriptionId = await createLiveSubscription('acct-resume');
		const scheduled = await provider.cancelSubscription(subscriptionId, 'period_end');

		const resumed = await provider.resumeSubscription(subscriptionId);

		expect(resumed.currentPeriodEnd).toEqual(scheduled.currentPeriodEnd);
	});

	// Hard cancel is support-and-deletion only, so it is deliberately outside the
	// contract: the product path is always period_end. CONTEXT.md.
	it('cancels immediately when asked to', async () => {
		const subscriptionId = await createLiveSubscription('acct-hard-cancel');

		const updated = await provider.cancelSubscription(subscriptionId, 'now');
		expect(updated.status).toBe('canceled');
	});
});
