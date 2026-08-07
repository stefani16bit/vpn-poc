import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';
import { type AuthenticatedUser, type SessionResponse, type SupportedLocale } from '@vpn/contracts';
import { CLOCK, type IClock } from '@vpn/ports';

import { TransactionRunner } from '../../../shared/database/transaction-runner.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { IdentityService } from '../../../shared/identity/identity.service.js';
import type { User } from '../../../shared/identity/user.js';
import { OutboxRepository } from '../../../shared/outbox/outbox.repository.js';
import {
	MODULE_LOGGER,
	type ModuleLogger,
	contextLogger,
} from '../../../shared/http/module-logger.js';
import { AccessTokenService } from '../../../shared/access-control/access-token.service.js';
import { RateLimitService } from '../../../shared/rate-limit/rate-limit.service.js';
import { RATE_LIMITS } from '../auth.rate-limits.js';
import { toAuthenticatedUser } from '../mappers/authenticated-user.mapper.js';
import { VerificationTokenService } from '../../../shared/verification/verification-token.service.js';

export interface IssuedSession {
	readonly response: SessionResponse;
	readonly refreshToken: string;
	readonly refreshExpiresAt: Date;
}

@Injectable()
export class AuthService {
	readonly #logger: ModuleLogger;

	constructor(
		@Inject(MODULE_LOGGER) logger: ModuleLogger,
		private readonly identity: IdentityService,
		@Inject(CLOCK) private readonly clock: IClock,
		@Inject(ENV) private readonly env: Env,
		private readonly accessTokens: AccessTokenService,
		private readonly verificationTokens: VerificationTokenService,
		private readonly rateLimit: RateLimitService,
		private readonly outbox: OutboxRepository,
		private readonly transactions: TransactionRunner,
	) {
		this.#logger = contextLogger(logger, AuthService.name);
	}

	async register(email: string, password: string, locale: SupportedLocale): Promise<void> {
		await this.rateLimit.consume(RATE_LIMITS.register, email);

		const registered = await this.transactions.runAsSystem(async (executor) => {
			const outcome = await this.identity.register(email, password, locale, executor);
			if (outcome.kind === 'email_taken') return false;

			await this.outbox.enqueue(
				outcome.user.accountId,
				{ kind: 'auth.verification', userId: outcome.user.id },
				executor,
			);
			return true;
		});

		if (!registered) {
			this.#logger.debug({ event: 'register.duplicate' }, 'registration for an existing address');
		}
	}

	async login(email: string, password: string, slug?: string): Promise<IssuedSession> {
		await this.rateLimit.consume(RATE_LIMITS.login, email);

		return this.transactions.runAsSystem(async () => {
			const user = await this.identity.authenticate(email, password, slug);
			if (!user) throw new AppError('INVALID_CREDENTIALS', 'e-mail or password is incorrect');

			if (!user.emailVerifiedAt) {
				throw new AppError('EMAIL_NOT_VERIFIED', 'confirm your e-mail address before signing in');
			}

			return this.#issueSession(user);
		});
	}

	async refresh(refreshToken: string): Promise<IssuedSession> {
		const { outcome, account } = await this.transactions.runAsSystem(async (executor) => {
			const rotation = await this.identity.refreshSession(refreshToken, executor);
			if (rotation.kind !== 'rotated') return { outcome: rotation, account: null };

			return { outcome: rotation, account: await this.identity.findById(rotation.session.userId) };
		});

		if (outcome.kind === 'reuse_detected') {
			this.#logger.warn(
				{ event: 'refresh.reuse_detected', sessionId: outcome.sessionId },
				'refresh token replayed; session family revoked',
			);
			throw new AppError('SESSION_REUSE_DETECTED', 'session was revoked, sign in again');
		}

		if (outcome.kind === 'rejected') {
			throw new AppError('UNAUTHENTICATED', 'session is no longer valid');
		}

		if (!account) throw new AppError('UNAUTHENTICATED', 'session is no longer valid');

		return {
			response: {
				user: toAuthenticatedUser(account),
				accessToken: await this.accessTokens.issue({
					userId: account.id,
					accountId: account.accountId,
					role: account.role,
					sessionId: outcome.session.sessionId,
					emailVerified: account.emailVerifiedAt !== null,
				}),
				expiresIn: this.accessTokens.ttlSeconds,
			},
			refreshToken: outcome.session.refreshToken,
			refreshExpiresAt: outcome.session.expiresAt,
		};
	}

	async logout(refreshToken: string | undefined): Promise<void> {
		if (!refreshToken) return;
		await this.transactions.runAsSystem(() => this.identity.revokeSession(refreshToken));
	}

	async verifyEmail(token: string): Promise<void> {
		await this.transactions.runAsSystem(async (executor) => {
			const redeemed = await this.verificationTokens.redeem(token, 'email_verification', executor);
			await this.identity.markEmailVerified(redeemed.userId, executor);

			await this.outbox.enqueue(
				redeemed.accountId,
				{ kind: 'auth.welcome', userId: redeemed.userId },
				executor,
			);
		});
	}

	async resendVerification(email: string): Promise<void> {
		await this.rateLimit.consume(RATE_LIMITS.resendVerification, email);

		await this.transactions.runAsSystem(async () => {
			const user = await this.identity.findByEmail(email);
			if (!user || user.emailVerifiedAt) return;

			await this.outbox.enqueue(user.accountId, { kind: 'auth.verification', userId: user.id });
		});
	}

	async setLocale(userId: string, locale: SupportedLocale): Promise<AuthenticatedUser> {
		await this.identity.setLocale(userId, locale);
		return this.currentUser(userId);
	}

	async forgotPassword(email: string): Promise<void> {
		await this.rateLimit.consume(RATE_LIMITS.forgotPassword, email);

		await this.transactions.runAsSystem(async () => {
			const user = await this.identity.findByEmail(email);
			if (!user) return;

			await this.outbox.enqueue(user.accountId, { kind: 'auth.password_reset', userId: user.id });
		});
	}

	async resetPassword(token: string, newPassword: string): Promise<void> {
		await this.transactions.runAsSystem(async (executor) => {
			const redeemed = await this.verificationTokens.redeem(token, 'password_reset', executor);

			await this.identity.changePassword(redeemed.userId, newPassword, executor);

			await this.outbox.enqueue(
				redeemed.accountId,
				{
					kind: 'auth.password_changed',
					userId: redeemed.userId,
					changedAt: this.clock.now().toISOString(),
				},
				executor,
			);
		});
	}

	async currentUser(userId: string): Promise<AuthenticatedUser> {
		const user = await this.identity.findById(userId);
		if (!user) throw new AppError('UNAUTHENTICATED', 'user no longer exists');
		return toAuthenticatedUser(user);
	}

	async #issueSession(account: User): Promise<IssuedSession> {
		const session = await this.identity.startSession(account);

		return {
			response: {
				user: toAuthenticatedUser(account),
				accessToken: await this.accessTokens.issue({
					userId: account.id,
					accountId: account.accountId,
					role: account.role,
					sessionId: session.sessionId,
					emailVerified: account.emailVerifiedAt !== null,
				}),
				expiresIn: this.accessTokens.ttlSeconds,
			},
			refreshToken: session.refreshToken,
			refreshExpiresAt: session.expiresAt,
		};
	}
}
