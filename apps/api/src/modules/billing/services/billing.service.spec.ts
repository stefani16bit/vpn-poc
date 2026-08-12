import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '@vpn-poc/env';
import type {
	IBillingProvider,
	IObjectStorage,
	Invoice,
	NormalizedBillingEvent,
	Subscription,
} from '@vpn/ports';
import { FixedClock } from '@vpn/testing/fakes';

import { AppError } from '../../../shared/errors/app-error.js';
import type { ModuleLogger } from '../../../shared/http/module-logger.js';
import type { TransactionRunner } from '../../../shared/database/transaction-runner.js';
import type { BillingEventRepository } from '../repositories/billing-event.repository.js';
import type { InvoiceRepository } from '../../../shared/subscriptions/invoice.repository.js';
import type {
	StoredSubscription,
	SubscriptionRepository,
} from '../../../shared/subscriptions/subscription.repository.js';
import type { EntitlementsService } from '../../../shared/entitlements/entitlements.service.js';
import type { OutboxRepository } from '../../../shared/outbox/outbox.repository.js';
import type {
	StoredUser,
	UserRepository,
} from '../../../shared/identity/repositories/user.repository.js';
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

const ACCOUNT = { id: 'acc-1', email: 'ada@example.com', locale: 'pt-BR' } as StoredUser;

const OCCURRED_AT = new Date('2026-08-01T00:00:00.000Z');

const NOW = new Date('2026-08-05T12:00:00.000Z');

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

function invoice(overrides: Partial<Invoice> = {}): Invoice {
	return {
		externalId: 'in_1',
		number: 'ACC-0001',
		status: 'failed',
		amountCents: 4900,
		currency: 'brl',
		issuedAt: OCCURRED_AT,
		...overrides,
	};
}

describe('BillingService', () => {
	let billing: {
		createCheckout: ReturnType<typeof vi.fn>;
		cancelSubscription: ReturnType<typeof vi.fn>;
		resumeSubscription: ReturnType<typeof vi.fn>;
		verifyWebhookSignature: ReturnType<typeof vi.fn>;
		parseWebhookEvent: ReturnType<typeof vi.fn>;
	};
	let identity: { findOwner: ReturnType<typeof vi.fn> };
	let subscriptions: {
		findByAccount: ReturnType<typeof vi.fn>;
		setCancelAtPeriodEnd: ReturnType<typeof vi.fn>;
		upsert: ReturnType<typeof vi.fn>;
	};
	let invoices: {
		listByAccount: ReturnType<typeof vi.fn>;
		findById: ReturnType<typeof vi.fn>;
		upsert: ReturnType<typeof vi.fn>;
		setPdfKey: ReturnType<typeof vi.fn>;
	};
	let storage: { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn> };
	let events: { claim: ReturnType<typeof vi.fn> };
	let outbox: { enqueue: ReturnType<typeof vi.fn> };
	let transactions: {
		runAsSystem: ReturnType<typeof vi.fn>;
		runInAccount: ReturnType<typeof vi.fn>;
	};
	let entitlements: { invalidate: ReturnType<typeof vi.fn> };
	let service: BillingService;

	beforeEach(() => {
		billing = {
			createCheckout: vi.fn().mockResolvedValue({ url: 'https://checkout.example/session' }),
			cancelSubscription: vi.fn().mockResolvedValue({ cancelAtPeriodEnd: true }),
			resumeSubscription: vi.fn().mockResolvedValue({ cancelAtPeriodEnd: false }),
			verifyWebhookSignature: vi.fn().mockReturnValue(true),
			parseWebhookEvent: vi.fn(),
		};
		identity = { findOwner: vi.fn().mockResolvedValue(ACCOUNT) };
		subscriptions = {
			findByAccount: vi.fn().mockResolvedValue(undefined),
			setCancelAtPeriodEnd: vi.fn().mockResolvedValue(undefined),
			upsert: vi.fn().mockResolvedValue(true),
		};
		invoices = {
			listByAccount: vi.fn().mockResolvedValue([]),
			findById: vi.fn().mockResolvedValue(undefined),
			upsert: vi.fn().mockResolvedValue('invoice-1'),
			setPdfKey: vi.fn().mockResolvedValue(undefined),
		};
		storage = { get: vi.fn().mockResolvedValue(null), put: vi.fn().mockResolvedValue(undefined) };
		events = { claim: vi.fn().mockResolvedValue(true) };
		outbox = { enqueue: vi.fn().mockResolvedValue(undefined) };

		transactions = {
			runAsSystem: vi.fn((work: (executor: unknown) => Promise<unknown>) => work(EXECUTOR)),
			runInAccount: vi.fn((_accountId: string, work: (executor: unknown) => Promise<unknown>) =>
				work(EXECUTOR),
			),
		};

		entitlements = { invalidate: vi.fn().mockResolvedValue(undefined) };

		records = [];
		service = new BillingService(
			recordingLogger(),
			billing as unknown as IBillingProvider,
			storage as unknown as IObjectStorage,
			identity as unknown as UserRepository,
			env,
			subscriptions as unknown as SubscriptionRepository,
			invoices as unknown as InvoiceRepository,
			events as unknown as BillingEventRepository,
			outbox as unknown as OutboxRepository,
			transactions as unknown as TransactionRunner,
			entitlements as unknown as EntitlementsService,
			new FixedClock(NOW),
		);
	});

	describe('createCheckout', () => {
		it('picks the price of the tier and cadence pair, not of the cadence alone', async () => {
			await service.createCheckout('acc-1', 'pro', 'yearly');
			expect(billing.createCheckout.mock.calls[0]?.[0]).toMatchObject({
				priceId: 'price_yearly',
			});
		});

		it('picks the monthly price otherwise', async () => {
			await service.createCheckout('acc-1', 'pro', 'monthly');
			expect(billing.createCheckout.mock.calls[0]?.[0]).toMatchObject({
				priceId: 'price_monthly',
			});
		});

		it('keys the session on account and plan, so a double click is one session', async () => {
			await service.createCheckout('acc-1', 'pro', 'monthly');
			expect(billing.createCheckout.mock.calls[0]?.[0]).toMatchObject({
				idempotencyKey: 'checkout:acc-1:pro:monthly',
			});
		});

		it('rejects an account that no longer exists', async () => {
			identity.findOwner.mockResolvedValue(undefined);
			await expect(service.createCheckout('acc-1', 'pro', 'monthly')).rejects.toBeInstanceOf(
				AppError,
			);
		});

		it('fails loudly when the plan has no configured price', async () => {
			const withoutYearly = new BillingService(
				recordingLogger(),
				billing as unknown as IBillingProvider,
				storage as unknown as IObjectStorage,
				identity as unknown as UserRepository,
				{ ...env, STRIPE_PRICE_ID_YEARLY: undefined } as Env,
				subscriptions as unknown as SubscriptionRepository,
				invoices as unknown as InvoiceRepository,
				events as unknown as BillingEventRepository,
				outbox as unknown as OutboxRepository,
				transactions as unknown as TransactionRunner,
				entitlements as unknown as EntitlementsService,
				new FixedClock(NOW),
			);

			await expect(withoutYearly.createCheckout('acc-1', 'pro', 'yearly')).rejects.toBeInstanceOf(
				AppError,
			);
		});
	});

	describe('invoices', () => {
		const stored = {
			id: 'inv-1',
			externalId: 'in_1',
			number: 'ACC-0001',
			status: 'paid' as const,
			amountCents: 4900,
			currency: 'brl',
			issuedAt: OCCURRED_AT,
			pdfKey: 'invoices/acc-1/in_1.pdf',
		};

		it('sends the issue date over the wire as an ISO string', async () => {
			invoices.listByAccount.mockResolvedValue([stored]);

			const listed = await service.listInvoices('acc-1');

			expect(listed.invoices[0]).toMatchObject({
				id: 'inv-1',
				status: 'paid',
				amountCents: 4900,
				issuedAt: OCCURRED_AT.toISOString(),
			});
		});

		it('says whether the document is there, so the screen offers no dead download', async () => {
			invoices.listByAccount.mockResolvedValue([stored, { ...stored, id: 'inv-2', pdfKey: null }]);

			const listed = await service.listInvoices('acc-1');

			expect(listed.invoices.map((entry) => entry.archived)).toEqual([true, false]);
		});

		it('never carries the storage key, which is ours and not the browser business', async () => {
			invoices.listByAccount.mockResolvedValue([stored]);

			const [first] = (await service.listInvoices('acc-1')).invoices;

			expect(JSON.stringify(first)).not.toContain('invoices/acc-1');
		});

		it('hands back the archived bytes', async () => {
			const body = new TextEncoder().encode('%PDF');
			invoices.findById.mockResolvedValue(stored);
			storage.get.mockResolvedValue({ body, contentType: 'application/pdf' });

			expect(await service.invoicePdf('acc-1', 'inv-1')).toBe(body);
			expect(storage.get).toHaveBeenCalledWith('invoices/acc-1/in_1.pdf');
		});

		it('answers not found for an invoice of another account, by the same path', async () => {
			invoices.findById.mockResolvedValue(undefined);

			await expect(service.invoicePdf('acc-1', 'inv-9')).rejects.toBeInstanceOf(AppError);
			expect(storage.get).not.toHaveBeenCalled();
		});

		it('answers not found while the document has not been archived yet', async () => {
			invoices.findById.mockResolvedValue({ ...stored, pdfKey: null });

			await expect(service.invoicePdf('acc-1', 'inv-1')).rejects.toBeInstanceOf(AppError);
		});

		it('answers not found when the row points at an object that is gone', async () => {
			invoices.findById.mockResolvedValue(stored);
			storage.get.mockResolvedValue(null);

			await expect(service.invoicePdf('acc-1', 'inv-1')).rejects.toBeInstanceOf(AppError);
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

	function stored(overrides: Partial<StoredSubscription> = {}): StoredSubscription {
		return {
			externalId: 'sub_1',
			status: 'active',
			currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
			cancelAtPeriodEnd: false,
			...overrides,
		} as StoredSubscription;
	}

	describe('cancel', () => {
		it('rejects when there is no subscription to cancel', async () => {
			await expect(service.cancel('acc-1')).rejects.toBeInstanceOf(AppError);
			expect(billing.cancelSubscription).not.toHaveBeenCalled();
		});

		it('cancels at period end and stores what the provider reported', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored());

			await service.cancel('acc-1');

			expect(billing.cancelSubscription).toHaveBeenCalledWith('sub_1', 'period_end');
			expect(subscriptions.setCancelAtPeriodEnd).toHaveBeenCalledWith('acc-1', true);
		});

		it('tells the account when the cancellation is scheduled, and by when access lasts', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored());
			billing.cancelSubscription.mockResolvedValue({
				cancelAtPeriodEnd: true,
				currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
			});

			await service.cancel('acc-1');

			expect(outbox.enqueue).toHaveBeenCalledWith('acc-1', {
				kind: 'billing.cancellation_scheduled',
				accountId: 'acc-1',
				requestedAt: NOW.toISOString(),
				endsAt: '2026-09-01T00:00:00.000Z',
			});
		});

		it('says nothing when the cancellation was already scheduled', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored({ cancelAtPeriodEnd: true }));

			await service.cancel('acc-1');

			expect(outbox.enqueue).not.toHaveBeenCalled();
		});
	});

	describe('resume', () => {
		it('rejects when there is no subscription to resume', async () => {
			await expect(service.resume('acc-1')).rejects.toBeInstanceOf(AppError);
			expect(billing.resumeSubscription).not.toHaveBeenCalled();
		});

		it('clears the schedule and stores what the provider reported', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored({ cancelAtPeriodEnd: true }));

			await service.resume('acc-1');

			expect(billing.resumeSubscription).toHaveBeenCalledWith('sub_1');
			expect(subscriptions.setCancelAtPeriodEnd).toHaveBeenCalledWith('acc-1', false);
		});

		it('tells the account the cancellation was undone', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored({ cancelAtPeriodEnd: true }));

			await service.resume('acc-1');

			expect(outbox.enqueue).toHaveBeenCalledWith('acc-1', {
				kind: 'billing.subscription_resumed',
				accountId: 'acc-1',
				requestedAt: NOW.toISOString(),
			});
		});

		it('says nothing when there was no cancellation to undo', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored());

			await service.resume('acc-1');

			expect(outbox.enqueue).not.toHaveBeenCalled();
		});

		it('trusts the provider over the request, so a refused resume is not written as done', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored({ cancelAtPeriodEnd: true }));
			billing.resumeSubscription.mockResolvedValue({ cancelAtPeriodEnd: true });

			await service.resume('acc-1');

			expect(subscriptions.setCancelAtPeriodEnd).toHaveBeenCalledWith('acc-1', true);
			expect(outbox.enqueue).not.toHaveBeenCalled();
		});

		it('leaves the projection untouched when the provider refuses', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored({ cancelAtPeriodEnd: true }));
			billing.resumeSubscription.mockRejectedValue(new Error('subscription is canceled'));

			await expect(service.resume('acc-1')).rejects.toThrow('subscription is canceled');
			expect(subscriptions.setCancelAtPeriodEnd).not.toHaveBeenCalled();
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
			expect(entitlements.invalidate).not.toHaveBeenCalled();
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

		it('queues an activation notification alongside the subscription it stored', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_activated',
				accountId: 'acc-1',
				externalEventId: 'evt-a',
				subscription: subscription(),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue).toHaveBeenCalledWith(
				'acc-1',
				{
					kind: 'billing.subscription_activated',
					accountId: 'acc-1',
					externalEventId: 'evt-a',
				},
				EXECUTOR,
			);
		});

		it('queues no activation for a subscription that is not yet paying for anything', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_activated',
				accountId: 'acc-1',
				externalEventId: 'evt-b',
				subscription: subscription({ status: 'incomplete' }),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(subscriptions.upsert).toHaveBeenCalled();
			expect(outbox.enqueue).not.toHaveBeenCalled();
		});

		it('queues an activation for a trial, which grants the tier just the same', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_activated',
				accountId: 'acc-1',
				externalEventId: 'evt-c',
				subscription: subscription({ status: 'trialing' }),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue).toHaveBeenCalledWith(
				'acc-1',
				expect.objectContaining({ kind: 'billing.subscription_activated' }),
				EXECUTOR,
			);
		});

		it('queues a payment failure notification and touches no subscription row', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'payment_failed',
				accountId: 'acc-1',
				externalEventId: 'evt-2',
				externalCustomerId: 'cus_1',
				invoice: invoice(),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue).toHaveBeenCalledWith(
				'acc-1',
				{ kind: 'billing.payment_failed', accountId: 'acc-1', externalEventId: 'evt-2' },
				EXECUTOR,
			);
			expect(subscriptions.upsert).not.toHaveBeenCalled();
		});

		it('projects the invoice a failed payment carries, without a second event', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'payment_failed',
				accountId: 'acc-1',
				externalEventId: 'evt-2',
				externalCustomerId: 'cus_1',
				invoice: invoice({ status: 'failed' }),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(invoices.upsert).toHaveBeenCalledWith(
				'acc-1',
				expect.objectContaining({ externalId: 'in_1', status: 'failed' }),
				OCCURRED_AT,
				EXECUTOR,
			);
			expect(events.claim).toHaveBeenCalledTimes(1);
		});

		it('projects a paid invoice and asks for the document, without mailing anyone', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'invoice_paid',
				accountId: 'acc-1',
				externalEventId: 'evt-3',
				externalCustomerId: 'cus_1',
				invoice: invoice({ status: 'paid' }),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(invoices.upsert).toHaveBeenCalled();
			expect(subscriptions.upsert).not.toHaveBeenCalled();
			expect(outbox.enqueue).toHaveBeenCalledWith(
				'acc-1',
				{
					kind: 'billing.invoice_archive',
					accountId: 'acc-1',
					invoiceId: 'invoice-1',
					externalInvoiceId: 'in_1',
				},
				EXECUTOR,
			);
			expect(outbox.enqueue).toHaveBeenCalledTimes(1);
		});

		// The upsert answers with nothing when its monotonic guard refused the
		// write, and a job for a row this event did not touch would archive a
		// document against a stale invoice.
		it('asks for no document when a late redelivery changed nothing', async () => {
			invoices.upsert.mockResolvedValue(undefined);
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'invoice_paid',
				accountId: 'acc-1',
				externalEventId: 'evt-4',
				externalCustomerId: 'cus_1',
				invoice: invoice({ status: 'paid' }),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue).not.toHaveBeenCalled();
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
				'acc-1',
				{
					kind: 'billing.subscription_canceled',
					accountId: 'acc-1',
					externalEventId: 'evt-3',
				},
				EXECUTOR,
			);
		});

		it('calls a cancellation a cancellation, even though it also takes the tier away', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored());
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_canceled',
				accountId: 'acc-1',
				externalEventId: 'evt-x',
				subscription: subscription({ status: 'canceled' }),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue).toHaveBeenCalledTimes(1);
			expect(outbox.enqueue.mock.calls[0]?.[1]).toMatchObject({
				kind: 'billing.subscription_canceled',
			});
		});

		it('tells the account when a subscription that started incomplete becomes active', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored({ status: 'incomplete' }));
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_updated',
				accountId: 'acc-1',
				externalEventId: 'evt-p',
				subscription: subscription({ status: 'active' }),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue).toHaveBeenCalledWith(
				'acc-1',
				{
					kind: 'billing.subscription_activated',
					accountId: 'acc-1',
					externalEventId: 'evt-p',
				},
				EXECUTOR,
			);
		});

		it('tells the account when dunning recovers and the tier comes back', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored({ status: 'past_due' }));
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_updated',
				accountId: 'acc-1',
				externalEventId: 'evt-q',
				subscription: subscription({ status: 'active' }),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue.mock.calls[0]?.[1]).toMatchObject({
				kind: 'billing.subscription_activated',
			});
		});

		it('does not announce an activation the late-event guard refused to apply', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored({ status: 'incomplete' }));
			subscriptions.upsert.mockResolvedValue(false);
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_updated',
				accountId: 'acc-1',
				externalEventId: 'evt-o',
				subscription: subscription({ status: 'active' }),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue).not.toHaveBeenCalled();
		});

		it('tells the account when a status change takes its tier away', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored());
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_updated',
				accountId: 'acc-1',
				externalEventId: 'evt-r',
				subscription: subscription({ status: 'past_due' }),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue).toHaveBeenCalledWith(
				'acc-1',
				{ kind: 'billing.access_revoked', accountId: 'acc-1', externalEventId: 'evt-r' },
				EXECUTOR,
			);
		});

		it('says nothing when the account had no tier to lose', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored({ status: 'past_due' }));
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_updated',
				accountId: 'acc-1',
				externalEventId: 'evt-s',
				subscription: subscription({ status: 'past_due' }),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue).not.toHaveBeenCalled();
		});

		it('does not announce a revocation the late-event guard refused to apply', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored());
			subscriptions.upsert.mockResolvedValue(false);
			billing.parseWebhookEvent.mockReturnValue({
				occurredAt: OCCURRED_AT,
				kind: 'subscription_updated',
				accountId: 'acc-1',
				externalEventId: 'evt-t',
				subscription: subscription({ status: 'past_due' }),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue).not.toHaveBeenCalled();
		});

		it('queues nothing for a renewal, which is not news the user needs', async () => {
			subscriptions.findByAccount.mockResolvedValue(stored());
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

			expect(transactions.runAsSystem).toHaveBeenCalledTimes(1);
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
				invoice: invoice(),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(outbox.enqueue.mock.calls[0]?.[2]).toBe(EXECUTOR);
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
				invoice: invoice(),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(identity.findOwner).not.toHaveBeenCalled();
		});

		const APPLIED_EVENTS: NormalizedBillingEvent[] = [
			{
				kind: 'subscription_activated',
				occurredAt: OCCURRED_AT,
				accountId: 'acc-1',
				externalEventId: 'evt-10',
				subscription: subscription(),
			},
			{
				kind: 'subscription_updated',
				occurredAt: OCCURRED_AT,
				accountId: 'acc-1',
				externalEventId: 'evt-11',
				subscription: subscription({ status: 'past_due' }),
			},
			{
				kind: 'subscription_canceled',
				occurredAt: OCCURRED_AT,
				accountId: 'acc-1',
				externalEventId: 'evt-12',
				subscription: subscription({ status: 'canceled' }),
			},
			{
				kind: 'payment_failed',
				occurredAt: OCCURRED_AT,
				accountId: 'acc-1',
				externalEventId: 'evt-13',
				externalCustomerId: 'cus_1',
				invoice: invoice(),
			},
		];

		it.each(APPLIED_EVENTS)('drops the cached entitlements of a $kind', async (event) => {
			billing.parseWebhookEvent.mockReturnValue(event);

			await service.handleWebhook('{}', 'sig');

			expect(entitlements.invalidate).toHaveBeenCalledWith('acc-1');
		});

		it('drops them after the transaction commits, not inside it', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				kind: 'subscription_updated',
				occurredAt: OCCURRED_AT,
				accountId: 'acc-1',
				externalEventId: 'evt-14',
				subscription: subscription({ status: 'past_due' }),
			} satisfies NormalizedBillingEvent);

			await service.handleWebhook('{}', 'sig');

			expect(subscriptions.upsert.mock.invocationCallOrder[0]).toBeLessThan(
				entitlements.invalidate.mock.invocationCallOrder[0] as number,
			);
		});

		it('leaves the cache alone when the write never landed', async () => {
			billing.parseWebhookEvent.mockReturnValue({
				kind: 'subscription_activated',
				occurredAt: OCCURRED_AT,
				accountId: 'acc-1',
				externalEventId: 'evt-15',
				subscription: subscription(),
			} satisfies NormalizedBillingEvent);
			subscriptions.upsert.mockRejectedValue(new Error('the database went away'));

			await expect(service.handleWebhook('{}', 'sig')).rejects.toThrow('the database went away');

			expect(entitlements.invalidate).not.toHaveBeenCalled();
		});
	});
});
