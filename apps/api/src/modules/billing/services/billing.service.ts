import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';
import {
	resolveTier,
	type Cadence,
	type InvoiceListResponse,
	type SubscriptionResponse,
	type SubscriptionStatusView,
	type TierId,
} from '@vpn/contracts';
import {
	BILLING_PROVIDER,
	CLOCK,
	OBJECT_STORAGE,
	type IBillingProvider,
	type IClock,
	type IObjectStorage,
	type Invoice,
	type NormalizedBillingEvent,
} from '@vpn/ports';

import { TransactionRunner, type Executor } from '../../../shared/database/transaction-runner.js';
import { EntitlementsService } from '../../../shared/entitlements/entitlements.service.js';
import { UserRepository } from '../../../shared/identity/repositories/user.repository.js';
import { OutboxRepository } from '../../../shared/outbox/outbox.repository.js';
import { AppError } from '../../../shared/errors/app-error.js';
import {
	MODULE_LOGGER,
	type ModuleLogger,
	contextLogger,
} from '../../../shared/http/module-logger.js';
import { InvoiceRepository } from '../../../shared/subscriptions/invoice.repository.js';
import { SubscriptionRepository } from '../../../shared/subscriptions/subscription.repository.js';
import { BillingEventRepository } from '../repositories/billing-event.repository.js';

const SOURCE = 'stripe';

const PRICE_ENV_BY_PLAN: Record<TierId, Record<Cadence, keyof Env>> = {
	pro: { monthly: 'STRIPE_PRICE_ID', yearly: 'STRIPE_PRICE_ID_YEARLY' },
};

type TierChange = 'gained' | 'lost' | 'none';

function tierChange(before: SubscriptionStatusView, after: SubscriptionStatusView): TierChange {
	const had = resolveTier(before) !== null;
	const has = resolveTier(after) !== null;

	if (had === has) return 'none';
	return has ? 'gained' : 'lost';
}

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
		@Inject(OBJECT_STORAGE) private readonly storage: IObjectStorage,
		private readonly users: UserRepository,
		@Inject(ENV) private readonly env: Env,
		private readonly subscriptions: SubscriptionRepository,
		private readonly invoices: InvoiceRepository,
		private readonly events: BillingEventRepository,
		private readonly outbox: OutboxRepository,
		private readonly transactions: TransactionRunner,
		private readonly entitlements: EntitlementsService,
		@Inject(CLOCK) private readonly clock: IClock,
	) {
		this.#logger = contextLogger(logger, BillingService.name);
	}

	// The read opens and closes its own transaction, and only then does the
	// provider get called. Holding the request transaction across that round trip
	// pins a pool connection to somebody else's latency; the alternative — an
	// escape hatch that reads outside a scope — is the unscoped query this whole
	// design refuses. DEC-035.
	async createCheckout(accountId: string, tier: TierId, cadence: Cadence): Promise<string> {
		const owner = await this.transactions.runInAccount(accountId, () =>
			this.users.findOwner(accountId),
		);
		if (!owner) throw new AppError('UNAUTHENTICATED', 'account no longer exists');

		const session = await this.billing.createCheckout({
			accountId,
			email: owner.email,
			priceId: this.#priceFor(tier, cadence),
			successUrl: `${this.env.WEB_ORIGIN}/billing/success`,
			cancelUrl: `${this.env.WEB_ORIGIN}/billing/cancel`,
			idempotencyKey: `checkout:${accountId}:${tier}:${cadence}`,
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
		const before = await this.subscriptions.findByAccount(accountId);
		if (!before) throw new AppError('NOT_FOUND', 'no subscription to cancel');

		const updated = await this.billing.cancelSubscription(before.externalId, 'period_end');

		await this.subscriptions.setCancelAtPeriodEnd(accountId, updated.cancelAtPeriodEnd);

		if (before.cancelAtPeriodEnd || !updated.cancelAtPeriodEnd) return;

		await this.outbox.enqueue(accountId, {
			kind: 'billing.cancellation_scheduled',
			accountId,
			requestedAt: this.clock.now().toISOString(),
			endsAt: updated.currentPeriodEnd?.toISOString() ?? null,
		});
	}

	async resume(accountId: string): Promise<void> {
		const before = await this.subscriptions.findByAccount(accountId);
		if (!before) throw new AppError('NOT_FOUND', 'no subscription to resume');

		const updated = await this.billing.resumeSubscription(before.externalId);

		await this.subscriptions.setCancelAtPeriodEnd(accountId, updated.cancelAtPeriodEnd);

		if (!before.cancelAtPeriodEnd || updated.cancelAtPeriodEnd) return;

		await this.outbox.enqueue(accountId, {
			kind: 'billing.subscription_resumed',
			accountId,
			requestedAt: this.clock.now().toISOString(),
		});
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

			let change: TierChange = 'none';

			if (event.kind !== 'payment_failed' && event.kind !== 'invoice_paid') {
				const before = await this.subscriptions.findByAccount(event.accountId, executor);

				const stored = await this.subscriptions.upsert(
					event.accountId,
					event.subscription,
					event.occurredAt,
					executor,
				);

				change = stored ? tierChange(before?.status ?? 'none', event.subscription.status) : 'none';
			} else {
				await this.#projectInvoice(event.accountId, event.invoice, event.occurredAt, executor);
			}

			await this.#enqueueNotification(event, change, executor);
			return true;
		});

		if (!applied) {
			this.#logger.debug(
				{ event: 'billing.webhook.duplicate', externalEventId: event.externalEventId },
				'ignoring redelivered webhook',
			);
			return false;
		}

		await this.entitlements.invalidate(event.accountId);

		return true;
	}

	async listInvoices(accountId: string): Promise<InvoiceListResponse> {
		const stored = await this.invoices.listByAccount(accountId);

		return {
			invoices: stored.map((invoice) => ({
				id: invoice.id,
				number: invoice.number,
				status: invoice.status,
				amountCents: invoice.amountCents,
				currency: invoice.currency,
				issuedAt: invoice.issuedAt.toISOString(),
				archived: invoice.pdfKey !== null,
			})),
		};
	}

	// The bytes travel through here rather than through a signed URL: the
	// permission is answered once per request, and no link outlives the check.
	async invoicePdf(accountId: string, id: string): Promise<Uint8Array> {
		const invoice = await this.invoices.findById(accountId, id);
		if (!invoice?.pdfKey) throw new AppError('NOT_FOUND', 'no archived invoice with that id');

		const stored = await this.storage.get(invoice.pdfKey);
		if (!stored) throw new AppError('NOT_FOUND', 'no archived invoice with that id');

		return stored.body;
	}

	async #projectInvoice(
		accountId: string,
		invoice: Invoice,
		occurredAt: Date,
		executor: Executor,
	): Promise<void> {
		const invoiceId = await this.invoices.upsert(accountId, invoice, occurredAt, executor);
		if (!invoiceId) return;

		await this.outbox.enqueue(
			accountId,
			{
				kind: 'billing.invoice_archive',
				accountId,
				invoiceId,
				externalInvoiceId: invoice.externalId,
			},
			executor,
		);
	}

	async #enqueueNotification(
		event: NormalizedBillingEvent,
		change: TierChange,
		executor: Executor,
	): Promise<void> {
		if (event.kind === 'invoice_paid') return;

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

		if (event.kind === 'subscription_canceled') {
			await this.outbox.enqueue(
				event.accountId,
				{
					kind: 'billing.subscription_canceled',
					accountId: event.accountId,
					externalEventId: event.externalEventId,
				},
				executor,
			);
			return;
		}

		if (change === 'none') return;

		await this.outbox.enqueue(
			event.accountId,
			{
				kind: change === 'gained' ? 'billing.subscription_activated' : 'billing.access_revoked',
				accountId: event.accountId,
				externalEventId: event.externalEventId,
			},
			executor,
		);
	}

	#priceFor(tier: TierId, cadence: Cadence): string {
		const priceId = this.env[PRICE_ENV_BY_PLAN[tier][cadence]];
		if (typeof priceId !== 'string' || priceId.length === 0) {
			throw new AppError('INTERNAL', `no price configured for plan "${tier}/${cadence}"`);
		}
		return priceId;
	}
}
