import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { type Database, verificationTokens } from '@vpn-poc/database';

import type { VerificationPurpose } from '../services/verification-token.purpose.js';

export interface ConsumedToken {
	readonly accountId: string;
	readonly expiresAt: Date;
}

@Injectable()
export class VerificationTokenRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async invalidateOutstanding(
		accountId: string,
		purpose: VerificationPurpose,
		at: Date,
	): Promise<void> {
		await this.db
			.update(verificationTokens)
			.set({ consumedAt: at })
			.where(
				and(
					eq(verificationTokens.accountId, accountId),
					eq(verificationTokens.purpose, purpose),
					isNull(verificationTokens.consumedAt),
				),
			);
	}

	async issue(
		accountId: string,
		purpose: VerificationPurpose,
		tokenHash: string,
		expiresAt: Date,
	): Promise<void> {
		await this.db.insert(verificationTokens).values({ tokenHash, accountId, purpose, expiresAt });
	}

	async consume(
		tokenHash: string,
		purpose: VerificationPurpose,
		at: Date,
	): Promise<ConsumedToken | undefined> {
		const consumed = await this.db
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
				accountId: verificationTokens.accountId,
				expiresAt: verificationTokens.expiresAt,
			});

		return consumed[0];
	}
}
