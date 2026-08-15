import Stripe from 'stripe';
import { beforeAll, describe, expect, it } from 'vitest';

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

describe('StripeBillingProvider webhook handling (pure)', () => {
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

describe('StripeBillingProvider against localstripe', () => {
	beforeAll(ensurePlan);

	it('reads a subscription back', async () => {
		const subscriptionId = await createLiveSubscription('acct-read');

		const subscription = await provider.getSubscription(subscriptionId);
		expect(subscription).toMatchObject({ externalId: subscriptionId, status: 'active' });
		expect(subscription?.currentPeriodEnd).toBeInstanceOf(Date);
	});

	it('returns null for a subscription that does not exist', async () => {
		await expect(provider.getSubscription('sub_does_not_exist')).resolves.toBeNull();
	});

	it('cancels at period end without ending access immediately', async () => {
		const subscriptionId = await createLiveSubscription('acct-soft-cancel');

		const updated = await provider.cancelSubscription(subscriptionId, 'period_end');
		expect(updated.cancelAtPeriodEnd).toBe(true);
		expect(updated.status).not.toBe('canceled');
	});

	it('undoes a scheduled cancellation without touching the period', async () => {
		const subscriptionId = await createLiveSubscription('acct-resume');
		const scheduled = await provider.cancelSubscription(subscriptionId, 'period_end');

		const resumed = await provider.resumeSubscription(subscriptionId);

		expect(scheduled.cancelAtPeriodEnd).toBe(true);
		expect(resumed.cancelAtPeriodEnd).toBe(false);
		expect(resumed.status).toBe('active');
		expect(resumed.currentPeriodEnd).toEqual(scheduled.currentPeriodEnd);
	});

	it('cancels immediately when asked to', async () => {
		const subscriptionId = await createLiveSubscription('acct-hard-cancel');

		const updated = await provider.cancelSubscription(subscriptionId, 'now');
		expect(updated.status).toBe('canceled');
	});
});
