import { Inject, Injectable } from '@nestjs/common';
import { and, isNotNull, lt, or } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { outbox, refreshTokens, verificationTokens, type Database } from '@vpn-poc/database';

import { currentExecutor } from '../database/db-scope.js';
import type { Executor } from '../database/transaction-runner.js';

export interface PurgeCounts {
	readonly verificationTokens: number;
	readonly refreshTokens: number;
	readonly outbox: number;
}

@Injectable()
export class RetentionRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	// A spent token still inside its window is evidence: replaying it is what
	// SESSION_REUSE_DETECTED reads, and deleting it early would turn a stolen
	// token into an unremarkable unknown one. So expiry alone decides here.
	async purgeRefreshTokens(before: Date, executor: Executor = currentExecutor()): Promise<number> {
		const deleted = await executor
			.delete(refreshTokens)
			.where(lt(refreshTokens.expiresAt, before))
			.returning({ tokenHash: refreshTokens.tokenHash });

		return deleted.length;
	}

	async purgeVerificationTokens(
		before: Date,
		executor: Executor = currentExecutor(),
	): Promise<number> {
		const deleted = await executor
			.delete(verificationTokens)
			.where(
				or(
					lt(verificationTokens.expiresAt, before),
					and(isNotNull(verificationTokens.consumedAt), lt(verificationTokens.consumedAt, before)),
				),
			)
			.returning({ tokenHash: verificationTokens.tokenHash });

		return deleted.length;
	}

	async purgeOutbox(before: Date, executor: Executor = currentExecutor()): Promise<number> {
		const deleted = await executor
			.delete(outbox)
			.where(and(isNotNull(outbox.publishedAt), lt(outbox.publishedAt, before)))
			.returning({ id: outbox.id });

		return deleted.length;
	}
}
