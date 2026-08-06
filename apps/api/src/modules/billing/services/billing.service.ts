import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE, ENV } from '@vpn-poc/adapters';
import { billingEvents, subscriptions, type Database } from '@vpn-poc/database';
import type { Env } from '@vpn-poc/env';
import type { PlanId, SubscriptionResponse } from '@vpn/contracts';
import {
	BILLING_PROVIDER,
	EMAIL_SENDER,
	IDENTITY_PROVIDER,
	type IBillingProvider,
	type IEmailSender,
	type IIdentityProvider,
	type NormalizedBillingEvent,
} from '@vpn/ports';

import { AppError } from '../../../shared/errors/app-error.js';

const SOURCE = 'stripe';

@Injectable()
export class BillingService {
	readonly #logger = new Logger(BillingService.name);

	constructor(
		@Inject(BILLING_PROVIDER) private readonly billing: IBillingProvider,
		@Inject(IDENTITY_PROVIDER) private readonly identity: IIdentityProvider,
		@Inject(EMAIL_SENDER) private readonly email: IEmailSender,
		@Inject(DATABASE) private readonly db: Database,
		@Inject(ENV) private readonly env: Env,
	) {}

	async createCheckout(accountId: string, plan: PlanId): Promise<string> {
		const account = await this.identity.findById(accountId);
		if (!account) throw new AppError('UNAUTHENTICATED', 'account no longer exists');

		const priceId = this.#priceFor(plan);

		const session = await this.billing.createCheckout({
			accountId,
			email: account.email,
			priceId,
			successUrl: `${this.env.WEB_ORIGIN}/billing/success`,
			cancelUrl: `${this.env.WEB_ORIGIN}/billing/cancel`,
			idempotencyKey: `checkout:${accountId}:${plan}`,
		});

		return session.url;
	}

	async currentSubscription(accountId: string): Promise<SubscriptionResponse> {
		const rows = await this.db
			.select()
			.from(subscriptions)
			.where(eq(subscriptions.accountId, accountId))
			.limit(1);

		const row = rows[0];
		if (!row) return { status: 'none', currentPeriodEnd: null, cancelAtPeriodEnd: false };

		return {
			status: row.status,
			currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
			cancelAtPeriodEnd: row.cancelAtPeriodEnd,
		};
	}

	async cancel(accountId: string): Promise<void> {
		const rows = await this.db
			.select({ externalId: subscriptions.externalId })
			.from(subscriptions)
			.where(eq(subscriptions.accountId, accountId))
			.limit(1);

		const externalId = rows[0]?.externalId;
		if (!externalId) throw new AppError('NOT_FOUND', 'no subscription to cancel');

		const updated = await this.billing.cancelSubscription(externalId, 'period_end');

		await this.db
			.update(subscriptions)
			.set({ cancelAtPeriodEnd: updated.cancelAtPeriodEnd, updatedAt: new Date() })
			.where(eq(subscriptions.accountId, accountId));
	}

	async handleWebhook(rawBody: string, signature: string): Promise<boolean> {
		if (!this.billing.verifyWebhookSignature(rawBody, signature)) {
			throw new AppError('FORBIDDEN', 'webhook signature is not valid');
		}

		const event = this.billing.parseWebhookEvent(rawBody);
		if (!event) return false;

		const claimed = await this.db
			.insert(billingEvents)
			.values({ source: SOURCE, externalEventId: event.externalEventId, kind: event.kind })
			.onConflictDoNothing({
				target: [billingEvents.source, billingEvents.externalEventId],
			})
			.returning({ id: billingEvents.id });

		if (claimed.length === 0) {
			this.#logger.debug(
				{ event: 'billing.webhook.duplicate', externalEventId: event.externalEventId },
				'ignoring redelivered webhook',
			);
			return false;
		}

		await this.#apply(event);
		return true;
	}

	async #apply(event: NormalizedBillingEvent): Promise<void> {
		if (event.kind === 'payment_failed') {
			const account = await this.identity.findById(event.accountId);
			if (!account) return;

			await this.email.send({
				to: account.email,
				template: 'payment_failed',
				locale: 'pt-BR',
				variables: { url: `${this.env.WEB_ORIGIN}/billing` },
				idempotencyKey: `payment-failed:${event.externalEventId}`,
			});
			return;
		}

		const { subscription } = event;

		await this.db
			.insert(subscriptions)
			.values({
				accountId: event.accountId,
				externalId: subscription.externalId,
				externalCustomerId: subscription.externalCustomerId,
				status: subscription.status,
				currentPeriodEnd: subscription.currentPeriodEnd,
				cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
			})
			.onConflictDoUpdate({
				target: subscriptions.accountId,
				set: {
					externalId: subscription.externalId,
					externalCustomerId: subscription.externalCustomerId,
					status: subscription.status,
					currentPeriodEnd: subscription.currentPeriodEnd,
					cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
					updatedAt: new Date(),
				},
			});

		if (event.kind === 'subscription_canceled') {
			const account = await this.identity.findById(event.accountId);
			if (!account) return;

			await this.email.send({
				to: account.email,
				template: 'subscription_canceled',
				locale: 'pt-BR',
				variables: {
					endsAt: subscription.currentPeriodEnd?.toISOString() ?? 'o fim do período vigente',
				},
				idempotencyKey: `subscription-canceled:${event.externalEventId}`,
			});
		}
	}

	#priceFor(plan: PlanId): string {
		const priceId = plan === 'yearly' ? this.env.STRIPE_PRICE_ID_YEARLY : this.env.STRIPE_PRICE_ID;
		if (!priceId) {
			throw new AppError('INTERNAL', `no price configured for plan "${plan}"`);
		}
		return priceId;
	}
}
