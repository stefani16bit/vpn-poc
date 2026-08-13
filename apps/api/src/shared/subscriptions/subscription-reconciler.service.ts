import { Inject, Injectable, Logger } from '@nestjs/common';

import {
	BILLING_PROVIDER,
	CACHE_STORE,
	CLOCK,
	type IBillingProvider,
	type ICacheStore,
	type IClock,
} from '@vpn/ports';

import { TransactionRunner } from '../database/transaction-runner.js';
import { entitlementCacheKey } from '../entitlements/entitlements.service.js';
import { SubscriptionRepository } from './subscription.repository.js';

const INTERVAL_SECONDS = 900;
const BATCH = 50;

const SWEEP_CLAIM = { owner: null, namespace: 'billing:sweep', id: 'subscriptions' } as const;

export interface SubscriptionReconcileReport {
	readonly checked: number;
	readonly corrected: number;
	readonly failed: number;
}

@Injectable()
export class SubscriptionReconciler {
	readonly #logger = new Logger(SubscriptionReconciler.name);

	constructor(
		@Inject(BILLING_PROVIDER) private readonly billing: IBillingProvider,
		private readonly subscriptions: SubscriptionRepository,
		private readonly transactions: TransactionRunner,
		@Inject(CACHE_STORE) private readonly cache: ICacheStore,
		@Inject(CLOCK) private readonly clock: IClock,
	) {}

	async runIfDue(): Promise<SubscriptionReconcileReport | null> {
		const claim = await this.cache.increment(SWEEP_CLAIM, INTERVAL_SECONDS);
		if (claim.count > 1) return null;

		return this.runOnce();
	}

	// The cache TTL shortens the window of a lost *invalidation*. It does nothing
	// for an event that never arrived: the projection simply stops moving, and an
	// account that stopped paying stays entitled for as long as nobody asks.
	// This is the asking.
	async runOnce(): Promise<SubscriptionReconcileReport> {
		const stale = await this.transactions.runAsSystem((executor) =>
			this.subscriptions.listForReconciliation(BATCH, executor),
		);

		let corrected = 0;
		let failed = 0;

		for (const local of stale) {
			try {
				if (await this.#converge(local)) corrected += 1;
			} catch (error) {
				failed += 1;
				this.#logger.warn(
					{ event: 'billing.reconcile_failed', externalId: local.externalId, error },
					'the provider did not answer for one subscription',
				);
			}
		}

		const report = { checked: stale.length, corrected, failed };

		if (corrected > 0) {
			this.#logger.warn(
				{ event: 'billing.reconciled', ...report },
				'the provider disagreed with the projection and the projection was corrected',
			);
		}

		return report;
	}

	async #converge(local: {
		accountId: string;
		externalId: string;
		status: string;
	}): Promise<boolean> {
		const remote = await this.billing.getSubscription(local.externalId);

		// A subscription the provider no longer knows is not a reason to guess a
		// status: dropping the row would revoke access on a bad lookup.
		if (!remote) return false;
		if (remote.status === local.status) {
			await this.#touch(local.accountId, remote);
			return false;
		}

		await this.#touch(local.accountId, remote);
		await this.cache.delete(entitlementCacheKey(local.accountId));

		return true;
	}

	#touch(
		accountId: string,
		remote: Awaited<ReturnType<IBillingProvider['getSubscription']>>,
	): Promise<unknown> {
		if (!remote) return Promise.resolve();

		// The clock is the event time here, not a provider timestamp: this is the
		// freshest reading there is, so the monotonic guard on the upsert has to
		// let it win over whatever the last webhook wrote.
		return this.transactions.runAsSystem((executor) =>
			this.subscriptions.upsert(accountId, remote, this.clock.now(), executor),
		);
	}
}
