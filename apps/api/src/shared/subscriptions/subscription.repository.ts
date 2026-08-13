import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { subscriptions, type Database } from '@vpn-poc/database';
import type { Subscription } from '@vpn/ports';

import { currentExecutor } from '../database/db-scope.js';
import type { Executor } from '../database/transaction-runner.js';

export interface StoredSubscription {
	readonly externalId: string;
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

	async listForReconciliation(
		limit: number,
		executor: Executor = currentExecutor(),
	): Promise<readonly { accountId: string; externalId: string; status: string }[]> {
		return executor
			.select({
				accountId: subscriptions.accountId,
				externalId: subscriptions.externalId,
				status: subscriptions.status,
			})
			.from(subscriptions)
			.orderBy(asc(subscriptions.updatedAt))
			.limit(limit);
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
	): Promise<boolean> {
		const applied = await executor
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
			})
			.returning({ accountId: subscriptions.accountId });

		return applied.length > 0;
	}
}
