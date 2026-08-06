import Stripe from 'stripe';

import type {
	CheckoutRequest,
	CheckoutSession,
	IBillingProvider,
	NormalizedBillingEvent,
	Subscription,
	SubscriptionStatus,
} from '@vpn/ports';

export interface StripeBillingProviderOptions {
	readonly apiKey: string;
	readonly webhookSecret: string;
	readonly apiBase?: string | undefined;
}

const ACCOUNT_METADATA_KEY = 'account_id';

export class StripeBillingProvider implements IBillingProvider {
	readonly #stripe: Stripe;
	readonly #webhookSecret: string;

	constructor(options: StripeBillingProviderOptions) {
		this.#stripe = new Stripe(options.apiKey, {
			...(options.apiBase ? { host: hostOf(options.apiBase), port: portOf(options.apiBase), protocol: protocolOf(options.apiBase) } : {}),
			apiVersion: '2025-02-24.acacia',
		});
		this.#webhookSecret = options.webhookSecret;
	}

	async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
		const session = await this.#stripe.checkout.sessions.create(
			{
				mode: 'subscription',
				line_items: [{ price: request.priceId, quantity: 1 }],
				customer_email: request.email,
				success_url: request.successUrl,
				cancel_url: request.cancelUrl,
				metadata: { [ACCOUNT_METADATA_KEY]: request.accountId },
				subscription_data: { metadata: { [ACCOUNT_METADATA_KEY]: request.accountId } },
			},
			{ idempotencyKey: request.idempotencyKey },
		);

		if (!session.url) throw new Error('Stripe returned a checkout session with no URL');
		return { externalId: session.id, url: session.url };
	}

	async getSubscription(externalId: string): Promise<Subscription | null> {
		try {
			const subscription = await this.#stripe.subscriptions.retrieve(externalId);
			return toSubscription(subscription);
		} catch (error) {
			if (error instanceof Stripe.errors.StripeInvalidRequestError && error.statusCode === 404) {
				return null;
			}
			throw error;
		}
	}

	async cancelSubscription(externalId: string, when: 'now' | 'period_end'): Promise<Subscription> {
		const updated =
			when === 'now'
				? await this.#stripe.subscriptions.cancel(externalId)
				: await this.#stripe.subscriptions.update(externalId, { cancel_at_period_end: true });

		return toSubscription(updated);
	}

	verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
		try {
			this.#stripe.webhooks.constructEvent(rawBody, signatureHeader, this.#webhookSecret);
			return true;
		} catch {
			return false;
		}
	}

	parseWebhookEvent(rawBody: string): NormalizedBillingEvent | null {
		const event = JSON.parse(rawBody) as Stripe.Event;

		switch (event.type) {
			case 'customer.subscription.created':
			case 'customer.subscription.updated': {
				const subscription = event.data.object as Stripe.Subscription;
				const accountId = accountIdOf(subscription.metadata);
				if (!accountId) return null;

				const normalized = toSubscription(subscription);
				return {
					kind:
						normalized.status === 'canceled'
							? 'subscription_canceled'
							: event.type === 'customer.subscription.created'
								? 'subscription_activated'
								: 'subscription_updated',
					externalEventId: event.id,
					accountId,
					subscription: normalized,
				};
			}

			case 'customer.subscription.deleted': {
				const subscription = event.data.object as Stripe.Subscription;
				const accountId = accountIdOf(subscription.metadata);
				if (!accountId) return null;
				return {
					kind: 'subscription_canceled',
					externalEventId: event.id,
					accountId,
					subscription: { ...toSubscription(subscription), status: 'canceled' },
				};
			}

			case 'invoice.payment_failed': {
				const invoice = event.data.object as Stripe.Invoice;
				const accountId = accountIdOf(invoice.subscription_details?.metadata ?? null);
				if (!accountId) return null;
				return {
					kind: 'payment_failed',
					externalEventId: event.id,
					accountId,
					externalCustomerId: String(invoice.customer ?? ''),
				};
			}

			default:
				return null;
		}
	}
}

function accountIdOf(metadata: Stripe.Metadata | null | undefined): string | null {
	const value = metadata?.[ACCOUNT_METADATA_KEY];
	return typeof value === 'string' && value.length > 0 ? value : null;
}

function toSubscription(subscription: Stripe.Subscription): Subscription {
	return {
		externalId: subscription.id,
		externalCustomerId: String(subscription.customer),
		status: toStatus(subscription.status),
		currentPeriodEnd: subscription.current_period_end
			? new Date(subscription.current_period_end * 1000)
			: null,
		cancelAtPeriodEnd: subscription.cancel_at_period_end,
	};
}

function toStatus(status: Stripe.Subscription.Status): SubscriptionStatus {
	switch (status) {
		case 'active':
			return 'active';
		case 'trialing':
			return 'trialing';
		case 'past_due':
		case 'unpaid':
			return 'past_due';
		case 'canceled':
			return 'canceled';
		default:
			return 'incomplete';
	}
}

function hostOf(base: string): string {
	return new URL(base).hostname;
}

function portOf(base: string): number {
	const url = new URL(base);
	return Number(url.port || (url.protocol === 'https:' ? 443 : 80));
}

function protocolOf(base: string): 'http' | 'https' {
	return new URL(base).protocol === 'https:' ? 'https' : 'http';
}
