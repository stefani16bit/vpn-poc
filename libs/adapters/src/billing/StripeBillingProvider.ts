import Stripe from 'stripe';

import type {
	CheckoutRequest,
	CheckoutSession,
	IBillingProvider,
	Invoice as PortInvoice,
	InvoiceStatus,
	NormalizedBillingEvent,
	Subscription,
	SubscriptionStatus,
} from '@vpn/ports';

export interface StripeBillingProviderOptions {
	readonly apiKey: string;
	readonly webhookSecrets: readonly string[];
	readonly apiBase?: string | undefined;
}

const ACCOUNT_METADATA_KEY = 'account_id';

export class StripeBillingProvider implements IBillingProvider {
	readonly #stripe: Stripe;
	readonly #webhookSecrets: readonly string[];

	constructor(options: StripeBillingProviderOptions) {
		if (options.webhookSecrets.length === 0) {
			throw new Error(
				'StripeBillingProvider refuses to be built without a webhook secret: STRIPE_WEBHOOK_SECRET_REF resolved to nothing',
			);
		}


		this.#stripe = new Stripe(options.apiKey, {
			...(options.apiBase
				? {
						host: hostOf(options.apiBase),
						port: portOf(options.apiBase),
						protocol: protocolOf(options.apiBase),
					}
				: {}),
			apiVersion: '2025-02-24.acacia',
		});
		this.#webhookSecrets = options.webhookSecrets;
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

	async resumeSubscription(externalId: string): Promise<Subscription> {
		const updated = await this.#stripe.subscriptions.update(externalId, {
			cancel_at_period_end: false,
		});

		return toSubscription(updated);
	}

	// Synchronous, and handed the same string it was always handed: the signature
	// covers the exact bytes received, so the secrets are resolved before this
	// object exists rather than fetched here. Both halves of the rotation window
	// are tried, because Stripe hands out two while an endpoint secret is being
	// replaced and either can arrive first.
	verifyWebhookSignature(rawBody: string, signatureHeader: string): boolean {
		return this.#webhookSecrets.some((secret) => {
			try {
				this.#stripe.webhooks.constructEvent(rawBody, signatureHeader, secret);
				return true;
			} catch {
				return false;
			}
		});
	}

	parseWebhookEvent(rawBody: string): NormalizedBillingEvent | null {
		const event = JSON.parse(rawBody) as Stripe.Event;
		const occurredAt = new Date(event.created * 1000);

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
					occurredAt,
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
					occurredAt,
					accountId,
					subscription: { ...toSubscription(subscription), status: 'canceled' },
				};
			}

			case 'invoice.payment_failed': {
				const invoice = event.data.object as Stripe.Invoice;
				const accountId = accountIdOf(subscriptionMetadataOf(invoice));
				if (!accountId) return null;
				return {
					kind: 'payment_failed',
					externalEventId: event.id,
					occurredAt,
					accountId,
					externalCustomerId: String(invoice.customer ?? ''),
					invoice: toInvoice(invoice, 'failed', occurredAt),
				};
			}

			case 'invoice.paid': {
				const invoice = event.data.object as Stripe.Invoice;
				const accountId = accountIdOf(subscriptionMetadataOf(invoice));
				if (!accountId) return null;
				return {
					kind: 'invoice_paid',
					externalEventId: event.id,
					occurredAt,
					accountId,
					externalCustomerId: String(invoice.customer ?? ''),
					invoice: toInvoice(invoice, 'paid', occurredAt),
				};
			}

			default:
				return null;
		}
	}

	async fetchInvoicePdf(externalInvoiceId: string): Promise<Uint8Array | null> {
		const invoice = await this.#stripe.invoices.retrieve(externalInvoiceId).catch(() => null);
		if (!invoice?.invoice_pdf) return null;

		const response = await fetch(invoice.invoice_pdf);
		if (!response.ok) return null;

		return new Uint8Array(await response.arrayBuffer());
	}
}

function toInvoice(invoice: Stripe.Invoice, status: InvoiceStatus, occurredAt: Date): PortInvoice {
	const seconds = secondsAt(invoice, 'created');

	return {
		externalId: String(invoice.id ?? ''),
		number: invoice.number ?? null,
		status,
		amountCents: status === 'paid' ? (invoice.amount_paid ?? 0) : (invoice.amount_due ?? 0),
		currency: invoice.currency,
		issuedAt: seconds === null ? occurredAt : new Date(seconds * 1000),
	};
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
		currentPeriodEnd: periodEndOf(subscription),
		cancelAtPeriodEnd: subscription.cancel_at_period_end,
	};
}

function periodEndOf(subscription: Stripe.Subscription): Date | null {
	const seconds =
		secondsAt(subscription, 'current_period_end') ??
		secondsAt(subscription.items?.data?.[0], 'current_period_end');

	return seconds === null ? null : new Date(seconds * 1000);
}

function subscriptionMetadataOf(invoice: Stripe.Invoice): Stripe.Metadata | null {
	const parent = propertyOf(invoice, 'parent');
	const nested = propertyOf(propertyOf(parent, 'subscription_details'), 'metadata');

	if (nested !== undefined && typeof nested === 'object' && nested !== null) {
		return nested as Stripe.Metadata;
	}

	return invoice.subscription_details?.metadata ?? null;
}

// The SDK types each field where the API version it was built against puts it, and
// both of these moved: current_period_end onto subscription items, and
// subscription_details under invoice.parent. A webhook endpoint keeps whatever
// version it was created with, so a payload of either shape can arrive at any time.
function propertyOf(value: unknown, key: string): unknown {
	if (typeof value !== 'object' || value === null) return undefined;
	return (value as Record<string, unknown>)[key];
}

function secondsAt(value: unknown, key: string): number | null {
	const seconds = propertyOf(value, key);
	return typeof seconds === 'number' ? seconds : null;
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
