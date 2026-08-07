import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { hashToken } from '@vpn-poc/adapters';
import { CLOCK, type IClock } from '@vpn/ports';

import type { Executor } from '../database/transaction-runner.js';
import { AppError } from '../errors/app-error.js';
import { VerificationTokenRepository } from './verification-token.repository.js';
import type { VerificationPurpose } from './verification-token.purpose.js';

const TOKEN_BYTES = 32;

export type { VerificationPurpose };

export interface IssuedToken {
	readonly token: string;
	readonly expiresAt: Date;
}

export interface RedeemedToken {
	readonly userId: string;
	readonly accountId: string;
}

@Injectable()
export class VerificationTokenService {
	constructor(
		private readonly tokens: VerificationTokenRepository,
		@Inject(CLOCK) private readonly clock: IClock,
	) {}

	async issue(
		user: { id: string; accountId: string },
		purpose: VerificationPurpose,
		ttlSeconds: number,
		executor?: Executor,
	): Promise<IssuedToken> {
		const now = this.clock.now();
		await this.tokens.invalidateOutstanding(user.id, purpose, now, executor);

		const token = randomBytes(TOKEN_BYTES).toString('base64url');
		const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

		await this.tokens.issue(
			{
				userId: user.id,
				accountId: user.accountId,
				purpose,
				tokenHash: hashToken(token),
				expiresAt,
			},
			executor,
		);

		return { token, expiresAt };
	}

	async redeem(
		token: string,
		purpose: VerificationPurpose,
		executor?: Executor,
	): Promise<RedeemedToken> {
		const now = this.clock.now();
		const row = await this.tokens.consume(hashToken(token), purpose, now, executor);

		if (!row) throw new AppError('TOKEN_INVALID', 'token is unknown or has already been used');

		if (row.expiresAt.getTime() <= now.getTime()) {
			throw new AppError('TOKEN_EXPIRED', 'token has expired');
		}

		return { userId: row.userId, accountId: row.accountId };
	}
}
