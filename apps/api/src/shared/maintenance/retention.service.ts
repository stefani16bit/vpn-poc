import { Inject, Injectable, Logger } from '@nestjs/common';

import { CACHE_STORE, CLOCK, type ICacheStore, type IClock } from '@vpn/ports';

import { TransactionRunner } from '../database/transaction-runner.js';
import { RetentionRepository, type PurgeCounts } from './retention.repository.js';

const INTERVAL_SECONDS = 3600;

// A dead row is kept a day past its usefulness so an incident still has
// yesterday to look at. Nothing here reads the grace but support does.
const GRACE_SECONDS = 24 * 60 * 60;

const PURGE_CLAIM = { owner: null, namespace: 'maintenance:purge', id: 'expired' } as const;

@Injectable()
export class RetentionSweeper {
	readonly #logger = new Logger(RetentionSweeper.name);

	constructor(
		private readonly retention: RetentionRepository,
		private readonly transactions: TransactionRunner,
		@Inject(CACHE_STORE) private readonly cache: ICacheStore,
		@Inject(CLOCK) private readonly clock: IClock,
	) {}

	async runIfDue(): Promise<PurgeCounts | null> {
		const claim = await this.cache.increment(PURGE_CLAIM, INTERVAL_SECONDS);
		if (claim.count > 1) return null;

		return this.runOnce();
	}

	// System, not tenant: the rows belong to every account at once, and a sweep
	// that had to pick one account would never reach the rest.
	async runOnce(): Promise<PurgeCounts> {
		const before = new Date(this.clock.now().getTime() - GRACE_SECONDS * 1000);

		const counts = await this.transactions.runAsSystem(async (executor) => ({
			verificationTokens: await this.retention.purgeVerificationTokens(before, executor),
			refreshTokens: await this.retention.purgeRefreshTokens(before, executor),
			outbox: await this.retention.purgeOutbox(before, executor),
		}));

		const total = counts.verificationTokens + counts.refreshTokens + counts.outbox;
		if (total > 0) {
			this.#logger.log({ event: 'retention.purged', ...counts }, 'expired rows were deleted');
		}

		return counts;
	}
}
