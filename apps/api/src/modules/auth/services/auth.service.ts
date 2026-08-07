import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';
import { type AuthenticatedUser, type SessionResponse, type SupportedLocale } from '@vpn/contracts';
import {
	CLOCK,
	IDENTITY_PROVIDER,
	type Account,
	type IClock,
	type IIdentityProvider,
} from '@vpn/ports';

import { AppError } from '../../../shared/errors/app-error.js';
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
		@Inject(IDENTITY_PROVIDER) private readonly identity: IIdentityProvider,
		@Inject(CLOCK) private readonly clock: IClock,
		@Inject(ENV) private readonly env: Env,
		private readonly accessTokens: AccessTokenService,
		private readonly verificationTokens: VerificationTokenService,
		private readonly rateLimit: RateLimitService,
		private readonly outbox: OutboxRepository,
	) {
		this.#logger = contextLogger(logger, AuthService.name);
	}

	async register(email: string, password: string, locale: SupportedLocale): Promise<void> {
		await this.rateLimit.consume(RATE_LIMITS.register, email);

		const outcome = await this.identity.register(email, password, locale);

		if (outcome.kind === 'email_taken') {
			this.#logger.debug({ event: 'register.duplicate' }, 'registration for an existing address');
			return;
		}

		await this.outbox.enqueue({ kind: 'auth.verification', accountId: outcome.account.id });
	}

	async login(email: string, password: string): Promise<IssuedSession> {
		await this.rateLimit.consume(RATE_LIMITS.login, email);

		const account = await this.identity.authenticate(email, password);
		if (!account) throw new AppError('INVALID_CREDENTIALS', 'e-mail or password is incorrect');

		if (!account.emailVerifiedAt) {
			throw new AppError('EMAIL_NOT_VERIFIED', 'confirm your e-mail address before signing in');
		}

		return this.#issueSession(account);
	}

	async refresh(refreshToken: string): Promise<IssuedSession> {
		const outcome = await this.identity.refreshSession(refreshToken);

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

		const account = await this.identity.findById(outcome.session.accountId);
		if (!account) throw new AppError('UNAUTHENTICATED', 'session is no longer valid');

		return {
			response: {
				user: toAuthenticatedUser(account),
				accessToken: await this.accessTokens.issue({
					accountId: account.id,
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
		if (refreshToken) await this.identity.revokeSession(refreshToken);
	}

	async verifyEmail(token: string): Promise<void> {
		const accountId = await this.verificationTokens.redeem(token, 'email_verification');
		await this.identity.markEmailVerified(accountId);

		await this.outbox.enqueue({ kind: 'auth.welcome', accountId });
	}

	async resendVerification(email: string): Promise<void> {
		await this.rateLimit.consume(RATE_LIMITS.resendVerification, email);

		const account = await this.identity.findByEmail(email);
		if (!account || account.emailVerifiedAt) return;

		await this.outbox.enqueue({ kind: 'auth.verification', accountId: account.id });
	}

	async setLocale(accountId: string, locale: SupportedLocale): Promise<AuthenticatedUser> {
		await this.identity.setLocale(accountId, locale);
		return this.currentUser(accountId);
	}

	async forgotPassword(email: string): Promise<void> {
		await this.rateLimit.consume(RATE_LIMITS.forgotPassword, email);

		const account = await this.identity.findByEmail(email);
		if (!account) return;

		await this.outbox.enqueue({ kind: 'auth.password_reset', accountId: account.id });
	}

	async resetPassword(token: string, newPassword: string): Promise<void> {
		const accountId = await this.verificationTokens.redeem(token, 'password_reset');

		await this.identity.changePassword(accountId, newPassword);

		await this.outbox.enqueue({
			kind: 'auth.password_changed',
			accountId,
			changedAt: this.clock.now().toISOString(),
		});
	}

	async currentUser(accountId: string): Promise<AuthenticatedUser> {
		const account = await this.identity.findById(accountId);
		if (!account) throw new AppError('UNAUTHENTICATED', 'account no longer exists');
		return toAuthenticatedUser(account);
	}

	async #issueSession(account: Account): Promise<IssuedSession> {
		const session = await this.identity.startSession(account.id);

		return {
			response: {
				user: toAuthenticatedUser(account),
				accessToken: await this.accessTokens.issue({
					accountId: account.id,
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
