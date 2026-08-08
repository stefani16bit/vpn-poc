import { Inject, Injectable } from '@nestjs/common';

import {
	entitlementsFor,
	resolveTier,
	type EntitlementsResponse,
	type SubscriptionStatusView,
	type TierId,
} from '@vpn/contracts';
import { CACHE_STORE, type CacheKey, type ICacheStore } from '@vpn/ports';

import { currentExecutor, hasScope } from '../database/db-scope.js';
import { TransactionRunner, type Executor } from '../database/transaction-runner.js';
import { SubscriptionRepository } from '../subscriptions/subscription.repository.js';

const NAMESPACE = 'entitlements';
const TTL_SECONDS = 60;

interface CachedTier {
	readonly tier: TierId | null;
}

export function entitlementCacheKey(accountId: string): CacheKey {
	return { owner: accountId, namespace: NAMESPACE, id: 'tier' };
}

@Injectable()
export class EntitlementsService {
	constructor(
		@Inject(CACHE_STORE) private readonly cache: ICacheStore,
		private readonly subscriptions: SubscriptionRepository,
		private readonly transactions: TransactionRunner,
	) {}

	async forAccount(accountId: string): Promise<EntitlementsResponse> {
		const cached = await this.cache.get<CachedTier>(entitlementCacheKey(accountId));
		if (cached) return present(cached.tier);

		const tier = resolveTier(await this.#status(accountId));
		await this.cache.set<CachedTier>(entitlementCacheKey(accountId), { tier }, TTL_SECONDS);

		return present(tier);
	}

	async invalidate(accountId: string): Promise<void> {
		await this.cache.delete(entitlementCacheKey(accountId));
	}

	#status(accountId: string): Promise<SubscriptionStatusView> {
		if (hasScope()) return this.#read(accountId, currentExecutor());

		return this.transactions.runInAccount(accountId, (executor) => this.#read(accountId, executor));
	}

	async #read(accountId: string, executor: Executor): Promise<SubscriptionStatusView> {
		const stored = await this.subscriptions.findByAccount(accountId, executor);
		return stored?.status ?? 'none';
	}
}

function present(tier: TierId | null): EntitlementsResponse {
	return { tier, entitlements: entitlementsFor(tier) };
}
