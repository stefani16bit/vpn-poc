import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';
import type { PlanId, SubscriptionResponse } from '@vpn/contracts';
import { BILLING_PROVIDER, type IBillingProvider, type NormalizedBillingEvent } from '@vpn/ports';

import { TransactionRunner, type Executor } from '../../../shared/database/transaction-runner.js';
import { UserRepository } from '../../../shared/identity/repositories/user.repository.js';
import { OutboxRepository } from '../../../shared/outbox/outbox.repository.js';
import { AppError } from '../../../shared/errors/app-error.js';
import {
	MODULE_LOGGER,
	type ModuleLogger,
	contextLogger,
} from '../../../shared/http/module-logger.js';
import { BillingEventRepository } from '../repositories/billing-event.repository.js';
import { SubscriptionRepository } from '../repositories/subscription.repository.js';

const SOURCE = 'stripe';

const NO_SUBSCRIPTION: SubscriptionResponse = {
	status: 'none',
	currentPeriodEnd: null,
	cancelAtPeriodEnd: false,
};

@Injectable()
export class BillingService {
	readonly #logger: ModuleLogger;

	constructor(
		@Inject(MODULE_LOGGER) logger: ModuleLogger,
		@Inject(BILLING_PROVIDER) private readonly billing: IBillingProvider,
		private readonly users: UserRepository,
		@Inject(ENV) private readonly env: Env,
		private readonly subscriptions: SubscriptionRepository,
		private readonly events: BillingEventRepository,
		private readonly outbox: OutboxRepository,
		private readonly transactions: TransactionRunner,
	) {
		this.#logger = contextLogger(logger, BillingService.name);
	}

	async createCheckout(accountId: string, plan: PlanId): Promise<string> {
		const owner = await this.users.findOwner(accountId);
		if (!owner) throw new AppError('UNAUTHENTICATED', 'account no longer exists');

		const session = await this.billing.createCheckout({
			accountId,
			email: owner.email,
			priceId: this.#priceFor(plan),
			successUrl: `${this.env.WEB_ORIGIN}/billing/success`,
			cancelUrl: `${this.env.WEB_ORIGIN}/billing/cancel`,
			idempotencyKey: `checkout:${accountId}:${plan}`,
		});

		return session.url;
	}

	async currentSubscription(accountId: string): Promise<SubscriptionResponse> {
		const row = await this.subscriptions.findByAccount(accountId);
		if (!row) return NO_SUBSCRIPTION;

		return {
			status: row.status,
			currentPeriodEnd: row.currentPeriodEnd?.toISOString() ?? null,
			cancelAtPeriodEnd: row.cancelAtPeriodEnd,
		};
	}

	async cancel(accountId: string): Promise<void> {
		const externalId = await this.subscriptions.findExternalId(accountId);
		if (!externalId) throw new AppError('NOT_FOUND', 'no subscription to cancel');

		const updated = await this.billing.cancelSubscription(externalId, 'period_end');

		await this.subscriptions.setCancelAtPeriodEnd(accountId, updated.cancelAtPeriodEnd);
	}

	async handleWebhook(rawBody: string, signature: string): Promise<boolean> {
		if (!this.billing.verifyWebhookSignature(rawBody, signature)) {
			throw new AppError('FORBIDDEN', 'webhook signature is not valid');
		}

		const event = this.billing.parseWebhookEvent(rawBody);
		if (!event) return false;

		const applied = await this.transactions.runAsSystem(async (executor) => {
			const claimed = await this.events.claim(SOURCE, event.externalEventId, event.kind, executor);
			if (!claimed) return false;

			if (event.kind !== 'payment_failed') {
				await this.subscriptions.upsert(
					event.accountId,
					event.subscription,
					event.occurredAt,
					executor,
				);
			}

			await this.#enqueueNotification(event, executor);
			return true;
		});

		if (!applied) {
			this.#logger.debug(
				{ event: 'billing.webhook.duplicate', externalEventId: event.externalEventId },
				'ignoring redelivered webhook',
			);
			return false;
		}

		return true;
	}

	async #enqueueNotification(event: NormalizedBillingEvent, executor: Executor): Promise<void> {
		if (event.kind === 'payment_failed') {
			await this.outbox.enqueue(
				event.accountId,
				{
					kind: 'billing.payment_failed',
					accountId: event.accountId,
					externalEventId: event.externalEventId,
				},
				executor,
			);
			return;
		}

		if (event.kind !== 'subscription_canceled') return;

		await this.outbox.enqueue(
			event.accountId,
			{
				kind: 'billing.subscription_canceled',
				accountId: event.accountId,
				externalEventId: event.externalEventId,
				endsAt: event.subscription.currentPeriodEnd?.toISOString() ?? null,
			},
			executor,
		);
	}

	#priceFor(plan: PlanId): string {
		const priceId = plan === 'yearly' ? this.env.STRIPE_PRICE_ID_YEARLY : this.env.STRIPE_PRICE_ID;
		if (!priceId) {
			throw new AppError('INTERNAL', `no price configured for plan "${plan}"`);
		}
		return priceId;
	}
}
