import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { subscriptions, type Database } from '@vpn-poc/database';
import type { Subscription } from '@vpn/ports';

import { currentExecutor } from '../../../shared/database/db-scope.js';
import type { Executor } from '../../../shared/database/transaction-runner.js';

export interface StoredSubscription {
	readonly status: typeof subscriptions.$inferSelect.status;
	readonly currentPeriodEnd: Date | null;
	readonly cancelAtPeriodEnd: boolean;
}

@Injectable()
export class SubscriptionRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async findByAccount(
		accountId: string,
		executor: Executor = currentExecutor(),
	): Promise<StoredSubscription | undefined> {
		const rows = await executor
			.select()
			.from(subscriptions)
			.where(eq(subscriptions.accountId, accountId))
			.limit(1);

		return rows[0];
	}

	async findExternalId(
		accountId: string,
		executor: Executor = currentExecutor(),
	): Promise<string | undefined> {
		const rows = await executor
			.select({ externalId: subscriptions.externalId })
			.from(subscriptions)
			.where(eq(subscriptions.accountId, accountId))
			.limit(1);

		return rows[0]?.externalId;
	}

	async setCancelAtPeriodEnd(
		accountId: string,
		cancelAtPeriodEnd: boolean,
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor
			.update(subscriptions)
			.set({ cancelAtPeriodEnd, updatedAt: new Date() })
			.where(eq(subscriptions.accountId, accountId));
	}

	async upsert(
		accountId: string,
		subscription: Subscription,
		occurredAt: Date,
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor
			.insert(subscriptions)
			.values({
				accountId,
				externalId: subscription.externalId,
				externalCustomerId: subscription.externalCustomerId,
				status: subscription.status,
				currentPeriodEnd: subscription.currentPeriodEnd,
				cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
				lastEventAt: occurredAt,
			})
			.onConflictDoUpdate({
				target: subscriptions.accountId,
				set: {
					externalId: subscription.externalId,
					externalCustomerId: subscription.externalCustomerId,
					status: subscription.status,
					currentPeriodEnd: subscription.currentPeriodEnd,
					cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
					lastEventAt: occurredAt,
					updatedAt: new Date(),
				},
				setWhere: sql`${subscriptions.lastEventAt} is null or ${subscriptions.lastEventAt} < ${occurredAt.toISOString()}::timestamptz`,
			});
	}
}
