import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { hashToken } from '@vpn-poc/adapters';
import { CLOCK, type IClock } from '@vpn/ports';

import { AppError } from '../errors/app-error.js';
import { VerificationTokenRepository } from './verification-token.repository.js';
import type { VerificationPurpose } from './verification-token.purpose.js';

const TOKEN_BYTES = 32;

export type { VerificationPurpose };

export interface IssuedToken {
	readonly token: string;
	readonly expiresAt: Date;
}

@Injectable()
export class VerificationTokenService {
	constructor(
		private readonly tokens: VerificationTokenRepository,
		@Inject(CLOCK) private readonly clock: IClock,
	) {}

	async issue(
		accountId: string,
		purpose: VerificationPurpose,
		ttlSeconds: number,
	): Promise<IssuedToken> {
		const now = this.clock.now();
		await this.tokens.invalidateOutstanding(accountId, purpose, now);

		const token = randomBytes(TOKEN_BYTES).toString('base64url');
		const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

		await this.tokens.issue(accountId, purpose, hashToken(token), expiresAt);

		return { token, expiresAt };
	}

	async redeem(token: string, purpose: VerificationPurpose): Promise<string> {
		const now = this.clock.now();
		const row = await this.tokens.consume(hashToken(token), purpose, now);

		if (!row) throw new AppError('TOKEN_INVALID', 'token is unknown or has already been used');

		if (row.expiresAt.getTime() <= now.getTime()) {
			throw new AppError('TOKEN_EXPIRED', 'token has expired');
		}

		return row.accountId;
	}
}
