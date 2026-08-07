import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '@vpn-poc/env';
import type {
	Account,
	IBillingProvider,
	IIdentityProvider,
	NormalizedBillingEvent,
	Subscription,
} from '@vpn/ports';

import { AppError } from '../../../shared/errors/app-error.js';
import type { ModuleLogger } from '../../../shared/http/module-logger.js';
import type { TransactionRunner } from '../../../shared/database/transaction-runner.js';
import type { BillingEventRepository } from '../repositories/billing-event.repository.js';
import type { SubscriptionRepository } from '../repositories/subscription.repository.js';
import type { OutboxRepository } from '../../../shared/outbox/outbox.repository.js';
import { BillingService } from './billing.service.js';

let records: Record<string, unknown>[];

function recordingLogger(): ModuleLogger {
	return pino(
		{ level: 'debug' },
		{
			write: (line: string) => {
				records.push(JSON.parse(line) as Record<string, unknown>);
			},
		},
	).child({ module: 'billing' });
}

const env = {
	WEB_ORIGIN: 'https://app.example.com',
	STRIPE_PRICE_ID: 'price_monthly',
	STRIPE_PRICE_ID_YEARLY: 'price_yearly',
} as Env;

const ACCOUNT = { id: 'acc-1', email: 'ada@example.com', locale: 'pt-BR' } as Account;

const OCCURRED_AT = new Date('2026-08-01T00:00:00.000Z');

const EXECUTOR = Symbol('executor');

function subscription(overrides: Partial<Subscription> = {}): Subscription {
	return {
		externalId: 'sub_1',
		externalCustomerId: 'cus_1',
		status: 'active',
		currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
		cancelAtPeriodEnd: false,
		...overrides,
	} as Subscription;
}

describe('BillingService', () => {
	let billing: {
		createCheckout: ReturnType<typeof vi.fn>;
		cancelSubscription: ReturnType<typeof vi.fn>;
		verifyWebhookSignature: ReturnType<typeof vi.fn>;
		parseWebhookEvent: ReturnType<typeof vi.fn>;
	};
	let identity: { findById: ReturnType<typeof vi.fn> };
	let subscriptions: {
		findByAccount: ReturnType<typeof vi.fn>;
		findExternalId: ReturnType<typeof vi.fn>;
		setCancelAtPeriodEnd: ReturnType<typeof vi.fn>;
		upsert: ReturnType<typeof vi.fn>;
	};
	let events: { claim: ReturnType<typeof vi.fn> };
	let outbox: { enqueue: ReturnType<typeof vi.fn> };
	let transactions: { run: ReturnType<typeof vi.fn> };
	let service: BillingService;

	beforeEach(() => {
		billing = {
			createCheckout: vi.fn().mockResolvedValue({ url: 'https://checkout.example/session' }),
			cancelSubscription: vi.fn().mockResolvedValue({ cancelAtPeriodEnd: true }),
			verifyWebhookSignature: vi.fn().mockReturnValue(true),
			parseWebhookEvent: vi.fn(),
		};
		identity = { findById: vi.fn().mockResolvedValue(ACCOUNT) };
		subscriptions = {
			findByAccount: vi.fn().mockResolvedValue(undefined),
			findExternalId: vi.fn().mockResolvedValue(undefined),
			setCancelAtPeriodEnd: vi.fn().mockResolvedValue(undefined),
			upsert: vi.fn().mockResolvedValue(undefined),
		};
		events = { claim: vi.fn().mockResolvedValue(true) };
		outbox = { enqueue: vi.fn().mockResolvedValue(undefined) };

		transactions = {
			run: vi.fn((work: (executor: unknown) => Promise<unknown>) => work(EXECUTOR)),
		};

		records = [];
		service = new BillingService(
			recordingLogger(),
			billing as unknown as IBillingProvider,
			identity as unknown as IIdentityProvider,
			env,
			subscriptions as unknown as SubscriptionRepository,
			events as unknown as BillingEventRepository,
			outbox as unknown as OutboxRepository,
			transactions as unknown as TransactionRunner,
		);
	});

	describe('createCheckout', () => {
		it('picks the yearly price for the yearly plan', async () => {
			await service.createCheckout('acc-1', 'yearly');
			expect(billing.createCheckout.mock.calls[0]?.[0]).toMatchObject({
				priceId: 'price_yearly',
			});
		});

		it('picks the monthly price otherwise', async () => {
			await service.createCheckout('acc-1', 'monthly');
			expect(billing.createCheckout.mock.calls[0]?.[0]).toMatchObject({
				priceId: 'price_monthly',
			});
		});

		it('keys the session on account and plan, so a double click is one session', async () => {
			await service.createCheckout('acc-1', 'monthly');
			expect(billing.createCheckout.mock.calls[0]?.[0]).toMatchObject({
				idempotencyKey: 'checkout:acc-1:monthly',
			});
		});

		it('rejects an account that no longer exists', async () => {
			identity.findById.mockResolvedValue(null);
			await expect(service.createCheckout('acc-1', 'monthly')).rejects.toBeInstanceOf(AppError);
		});

		it('fails loudly when the plan has no configured price', async () => {
			const withoutYearly = new BillingService(
				recordingLogger(),
				billing as unknown as IBillingProvider,
				identity as unknown as IIdentityProvider,
				{ ...env, STRIPE_PRICE_ID_YEARLY: undefined } as Env,
				subscriptions as unknown as SubscriptionRepository,
				events as unknown as BillingEventRepository,
				outbox as unknown as OutboxRepository,
				transactions as unknown as TransactionRunner,
			);

			await expect(withoutYearly.createCheckout('acc-1', 'yearly')).rejects.toBeInstanceOf(
				AppError,
			);
		});
	});

	describe('currentSubscription', () => {
		it('reports none when the account has no row', async () => {
			expect(await service.currentSubscription('acc-1')).toEqual({
				status: 'none',
				currentPeriodEnd: null,
				cancelAtPeriodEnd: false,
			});
		});

		it('sends the period end over the wire as an ISO string', async () => {
			subscriptions.findByAccount.mockResolvedValue({
				status: 'active',
				currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
				cancelAtPeriodEnd: false,
			});

			expect(await service.currentSubscription('acc-1')).toMatchObject({
				status: 'active',
				currentPeriodEnd: '2026-09-01T00:00:00.000Z',
			});
		});

		it('reports a null period end as null rather than omitting it', async () => {
			subscriptions.findByAccount.mockResolvedValue({
				status: 'active',
				currentPeriodEnd: null,
				cancelAtPeriodEnd: true,
			});

			expect(await service.currentSubscription('acc-1')).toMatchObject({
				currentPeriodEnd: null,
				cancelAtPeriodEnd: true,
			});
		});
	});

	describe('cancel', () => {
		it('rejects when there is no subscription to cancel', async () => {
			await expect(service.cancel('acc-1')).rejects.toBeInstanceOf(AppError);
			expect(billing.cancelSubscription).not.toHaveBeenCalled();
		});

		it('cancels at period end and stores what the provider reported', async () => {
			subscriptions.findExternalId.mockResolvedValue('sub_1');

			await service.cancel('acc-1');

			expect(billing.cancelSubscription).toHaveBeenCalledWith('sub_1', 'period_end');
			expect(subscriptions.setCancelAtPeriodEnd).toHaveBeenCalledWith('acc-1', true);
		});
	});

	describe('handleWebhook', () => {
		it('rejects a body whose signature does not verify', async () => {
			billing.verifyWebhookSignature.mockReturnValue(false);

			await expect(service.handleWebhook('{}', 'sig')).rejects.toBeInstanceOf(AppError);
			expect(events.claim).not.toHaveBeenCalled();
		});

		it('ignores a body it cannot parse into a known event', async () => {
			billing.parseWebhookEvent.mockReturnValue(null);

			expect(await service.handleWebhook('{}', 'sig')).toBe(false);
			expect(events.claim).not.toHaveBeenCalled();
		});

		it('applies nothing when the claim is lost to a redelivery', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_activated',
				accountId: 'acc-1',
				externalEventId: 'evt-1',
				subscription: subscription(),
			} satisfies NormalizedBillingEvent);
			events.claim.mockResolvedValue(false);

			expect(await service.handleWebhook('{}', 'sig')).toBe(false);
			expect(subscriptions.upsert).not.toHaveBeenCalled();
			expect(outbox.enqueue).not.toHaveBeenCalled();
			expect(records).toContainEqual(
				expect.objectContaining({
					module: 'billing',
					context: 'BillingService',
					event: 'billing.webhook.duplicate',
				}),
			);
		});

		it('claims the event against the source and the provider event id', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_activated',
				accountId: 'acc-1',
				externalEventId: 'evt-1',
				subscription: subscription(),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(events.claim).toHaveBeenCalledWith(
				'stripe',
				'evt-1',
				'subscription_activated',
				EXECUTOR,
			);
		});

		it('stores the subscription an activation carries', async () => {
			const sub = subscription();
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_activated',
				accountId: 'acc-1',
				externalEventId: 'evt-1',
				subscription: sub,
			} satisfies NormalizedBillingEvent);

			expect(await service.handleWebhook('{}', 'sig')).toBe(true);
			expect(subscriptions.upsert).toHaveBeenCalledWith('acc-1', sub, OCCURRED_AT, EXECUTOR);
		});

		it('queues a payment failure notification and touches no subscription row', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'payment_failed',
				accountId: 'acc-1',
				externalEventId: 'evt-2',
				externalCustomerId: 'cus_1',
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue).toHaveBeenCalledWith(
				{ kind: 'billing.payment_failed', accountId: 'acc-1', externalEventId: 'evt-2' },
				EXECUTOR,
			);
			expect(subscriptions.upsert).not.toHaveBeenCalled();
		});

		it('stores and queues on a cancellation, carrying the period end as a string', async () => {
			const sub = subscription({ status: 'canceled' });
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_canceled',
				accountId: 'acc-1',
				externalEventId: 'evt-3',
				subscription: sub,
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(subscriptions.upsert).toHaveBeenCalledWith('acc-1', sub, OCCURRED_AT, EXECUTOR);
			expect(outbox.enqueue).toHaveBeenCalledWith(
				{
					kind: 'billing.subscription_canceled',
					accountId: 'acc-1',
					externalEventId: 'evt-3',
					endsAt: sub.currentPeriodEnd?.toISOString(),
				},
				EXECUTOR,
			);
		});

		it('queues nothing for a renewal, which is not news the user needs', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_updated',
				accountId: 'acc-1',
				externalEventId: 'evt-4',
				subscription: subscription(),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue).not.toHaveBeenCalled();
		});

		it('claims and applies inside one transaction, so a failure takes the claim with it', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				kind: 'subscription_activated',
				occurredAt: OCCURRED_AT,
				accountId: 'acc-1',
				externalEventId: 'evt-6',
				subscription: subscription(),
			} satisfies NormalizedBillingEvent);
			subscriptions.upsert.mockRejectedValue(new Error('the database went away'));

			await expect(service.handleWebhook('{}', 'sig')).rejects.toThrow('the database went away');

			expect(transactions.run).toHaveBeenCalledTimes(1);
			expect(events.claim.mock.invocationCallOrder[0]).toBeLessThan(
				subscriptions.upsert.mock.invocationCallOrder[0] as number,
			);
		});

		it('queues the notification inside the transaction, so a rollback takes it too', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				kind: 'payment_failed',
				occurredAt: OCCURRED_AT,
				accountId: 'acc-1',
				externalEventId: 'evt-7',
				externalCustomerId: 'cus_1',
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue.mock.calls[0]?.[1]).toBe(EXECUTOR);
		});

		it('refuses the whole webhook when the notification cannot be queued', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				kind: 'subscription_canceled',
				occurredAt: OCCURRED_AT,
				accountId: 'acc-1',
				externalEventId: 'evt-8',
				subscription: subscription({ status: 'canceled' }),
			} satisfies NormalizedBillingEvent);
			outbox.enqueue.mockRejectedValue(new Error('the database went away'));

			await expect(service.handleWebhook('{}', 'sig')).rejects.toThrow('the database went away');
		});

		it('passes the provider timestamp through, so a stale event can be rejected', async () => {
			const sub = subscription();
			billing.parseWebhookEvent.mockReturnValue({
				kind: 'subscription_updated',
				occurredAt: OCCURRED_AT,
				accountId: 'acc-1',
				externalEventId: 'evt-9',
				subscription: sub,
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(subscriptions.upsert).toHaveBeenCalledWith('acc-1', sub, OCCURRED_AT, EXECUTOR);
		});

		it('does not look the account up: whether it still exists is the worker business', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'payment_failed',
				accountId: 'acc-1',
				externalEventId: 'evt-5',
				externalCustomerId: 'cus_1',
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(identity.findById).not.toHaveBeenCalled();
		});
	});
});
