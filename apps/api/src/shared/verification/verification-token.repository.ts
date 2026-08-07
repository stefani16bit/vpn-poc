import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { type Database, verificationTokens } from '@vpn-poc/database';

import { currentExecutor } from '../database/db-scope.js';
import type { Executor } from '../database/transaction-runner.js';
import type { VerificationPurpose } from './verification-token.purpose.js';

export interface ConsumedToken {
	readonly userId: string;
	readonly accountId: string;
	readonly expiresAt: Date;
}

@Injectable()
export class VerificationTokenRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async invalidateOutstanding(
		userId: string,
		purpose: VerificationPurpose,
		at: Date,
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor
			.update(verificationTokens)
			.set({ consumedAt: at })
			.where(
				and(
					eq(verificationTokens.userId, userId),
					eq(verificationTokens.purpose, purpose),
					isNull(verificationTokens.consumedAt),
				),
			);
	}

	async issue(
		values: {
			userId: string;
			accountId: string;
			purpose: VerificationPurpose;
			tokenHash: string;
			expiresAt: Date;
		},
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor.insert(verificationTokens).values(values);
	}

	async consume(
		tokenHash: string,
		purpose: VerificationPurpose,
		at: Date,
		executor: Executor = currentExecutor(),
	): Promise<ConsumedToken | undefined> {
		const consumed = await executor
			.update(verificationTokens)
			.set({ consumedAt: at })
			.where(
				and(
					eq(verificationTokens.tokenHash, tokenHash),
					eq(verificationTokens.purpose, purpose),
					isNull(verificationTokens.consumedAt),
				),
			)
			.returning({
				userId: verificationTokens.userId,
				accountId: verificationTokens.accountId,
				expiresAt: verificationTokens.expiresAt,
			});

		return consumed[0];
	}
}
