import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock, MemoryCacheStore } from '@vpn/testing/fakes';
import type { IBillingProvider, Subscription } from '@vpn/ports';

import type { TransactionRunner } from '../database/transaction-runner.js';
import { SubscriptionReconciler } from './subscription-reconciler.service.js';
import type { SubscriptionRepository } from './subscription.repository.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

function remote(overrides: Partial<Subscription> = {}): Subscription {
	return {
		externalId: 'sub_1',
		externalCustomerId: 'cus_1',
		status: 'active',
		currentPeriodEnd: new Date('2026-02-01T00:00:00.000Z'),
		cancelAtPeriodEnd: false,
		...overrides,
	};
}

function reconciler(
	rows: readonly { accountId: string; externalId: string; status: string }[] = [],
) {
	const clock = new FixedClock(NOW);
	const cache = new MemoryCacheStore(clock);

	const getSubscription = vi.fn(() => Promise.resolve(remote()));
	const billing = { getSubscription } as unknown as IBillingProvider;

	const upsert = vi.fn(() => Promise.resolve(true));
	const subscriptions = {
		listForReconciliation: () => Promise.resolve(rows),
		upsert,
	} as unknown as SubscriptionRepository;

	const transactions = {
		runAsSystem: <T>(work: (executor: unknown) => Promise<T>) => work(Symbol('executor')),
	} as unknown as TransactionRunner;

	const invalidate = vi.spyOn(cache, 'delete');

	const subject = new SubscriptionReconciler(billing, subscriptions, transactions, cache, clock);
	const twin = new SubscriptionReconciler(billing, subscriptions, transactions, cache, clock);

	return { subject, twin, clock, getSubscription, upsert, invalidate };
}

const ACTIVE = { accountId: 'acc-1', externalId: 'sub_1', status: 'active' };
const STALE = { accountId: 'acc-1', externalId: 'sub_1', status: 'active' };

describe('SubscriptionReconciler', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('asks the provider about what the projection holds', async () => {
		const { subject, getSubscription } = reconciler([ACTIVE]);

		expect(await subject.runOnce()).toMatchObject({ checked: 1 });
		expect(getSubscription).toHaveBeenCalledWith('sub_1');
	});

	// The whole point: a webhook that never arrived leaves an account entitled
	// forever, and no cache TTL shortens that.
	it('corrects a projection the provider has moved past, and drops the entitlement cache', async () => {
		const { subject, getSubscription, upsert, invalidate } = reconciler([STALE]);
		getSubscription.mockResolvedValue(remote({ status: 'canceled' }));

		const report = await subject.runOnce();

		expect(report).toMatchObject({ checked: 1, corrected: 1, failed: 0 });
		expect(upsert).toHaveBeenCalledWith(
			'acc-1',
			expect.objectContaining({ status: 'canceled' }),
			NOW,
			expect.anything(),
		);
		expect(invalidate).toHaveBeenCalledWith(
			expect.objectContaining({ owner: 'acc-1', namespace: 'entitlements' }),
		);
	});

	it('writes the reading with the current instant, so the monotonic guard lets it win', async () => {
		const { subject, upsert } = reconciler([ACTIVE]);

		await subject.runOnce();

		expect(upsert).toHaveBeenCalledWith('acc-1', expect.anything(), NOW, expect.anything());
	});

	it('reports nothing corrected when the two already agree', async () => {
		const { subject, invalidate } = reconciler([ACTIVE]);

		expect(await subject.runOnce()).toMatchObject({ corrected: 0 });
		expect(invalidate).not.toHaveBeenCalled();
	});

	// Deleting the row on a lookup that came back empty would revoke access for a
	// paying account the first time the provider hiccups.
	it('leaves the projection alone when the provider knows nothing about it', async () => {
		const { subject, getSubscription, upsert, invalidate } = reconciler([ACTIVE]);
		getSubscription.mockResolvedValue(null as unknown as Subscription);

		expect(await subject.runOnce()).toMatchObject({ checked: 1, corrected: 0 });
		expect(upsert).not.toHaveBeenCalled();
		expect(invalidate).not.toHaveBeenCalled();
	});

	it('keeps sweeping past a subscription the provider refused to answer for', async () => {
		const { subject, getSubscription } = reconciler([
			ACTIVE,
			{ accountId: 'acc-2', externalId: 'sub_2', status: 'active' },
		]);
		getSubscription.mockRejectedValueOnce(new Error('provider timeout'));

		expect(await subject.runOnce()).toMatchObject({ checked: 2, failed: 1 });
	});

	it('lets one of two workers sweep, not both', async () => {
		const { subject, twin } = reconciler([ACTIVE]);

		expect(await subject.runIfDue()).not.toBeNull();
		expect(await twin.runIfDue()).toBeNull();
	});

	it('sweeps again once the window has elapsed', async () => {
		const { subject, clock } = reconciler([ACTIVE]);
		await subject.runIfDue();

		clock.advance(901);

		expect(await subject.runIfDue()).not.toBeNull();
	});
});
