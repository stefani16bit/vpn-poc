import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { subscriptions, type Database } from '@vpn-poc/database';
import type { Subscription } from '@vpn/ports';

export interface StoredSubscription {
	readonly status: typeof subscriptions.$inferSelect.status;
	readonly currentPeriodEnd: Date | null;
	readonly cancelAtPeriodEnd: boolean;
}

@Injectable()
export class SubscriptionRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async findByAccount(accountId: string): Promise<StoredSubscription | undefined> {
		const rows = await this.db
			.select()
			.from(subscriptions)
			.where(eq(subscriptions.accountId, accountId))
			.limit(1);

		return rows[0];
	}

	async findExternalId(accountId: string): Promise<string | undefined> {
		const rows = await this.db
			.select({ externalId: subscriptions.externalId })
			.from(subscriptions)
			.where(eq(subscriptions.accountId, accountId))
			.limit(1);

		return rows[0]?.externalId;
	}

	async setCancelAtPeriodEnd(accountId: string, cancelAtPeriodEnd: boolean): Promise<void> {
		await this.db
			.update(subscriptions)
			.set({ cancelAtPeriodEnd, updatedAt: new Date() })
			.where(eq(subscriptions.accountId, accountId));
	}

	async upsert(accountId: string, subscription: Subscription): Promise<void> {
		await this.db
			.insert(subscriptions)
			.values({
				accountId,
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
	}
}
