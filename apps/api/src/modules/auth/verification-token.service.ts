import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { type Database, verificationTokens } from '@vpn-poc/database';
import { hashToken } from '@vpn-poc/adapters';
import { CLOCK, type IClock } from '@vpn/ports';

import { AppError } from '../../common/errors/app-error.js';

export type VerificationPurpose = 'email_verification' | 'password_reset';

export interface IssuedToken {
	readonly token: string;
	readonly expiresAt: Date;
}

@Injectable()
export class VerificationTokenService {
	constructor(
		@Inject(DATABASE) private readonly db: Database,
		@Inject(CLOCK) private readonly clock: IClock,
	) {}

	async issue(
		accountId: string,
		purpose: VerificationPurpose,
		ttlSeconds: number,
	): Promise<IssuedToken> {
		await this.db
			.update(verificationTokens)
			.set({ consumedAt: this.clock.now() })
			.where(
				and(
					eq(verificationTokens.accountId, accountId),
					eq(verificationTokens.purpose, purpose),
					isNull(verificationTokens.consumedAt),
				),
			);

		const token = randomBytes(32).toString('base64url');
		const expiresAt = new Date(this.clock.now().getTime() + ttlSeconds * 1000);

		await this.db
			.insert(verificationTokens)
			.values({ tokenHash: hashToken(token), accountId, purpose, expiresAt });

		return { token, expiresAt };
	}

	async redeem(token: string, purpose: VerificationPurpose): Promise<string> {
		const now = this.clock.now();

		const consumed = await this.db
			.update(verificationTokens)
			.set({ consumedAt: now })
			.where(
				and(
					eq(verificationTokens.tokenHash, hashToken(token)),
					eq(verificationTokens.purpose, purpose),
					isNull(verificationTokens.consumedAt),
				),
			)
			.returning({
				accountId: verificationTokens.accountId,
				expiresAt: verificationTokens.expiresAt,
			});

		const row = consumed[0];
		if (!row) throw new AppError('TOKEN_INVALID', 'token is unknown or has already been used');

		if (row.expiresAt.getTime() <= now.getTime()) {
			throw new AppError('TOKEN_EXPIRED', 'token has expired');
		}

		return row.accountId;
	}
}
