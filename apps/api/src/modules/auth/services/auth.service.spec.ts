import { pino } from 'pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '@vpn-poc/env';
import { FixedClock } from '@vpn/testing/fakes';

import type { AccessTokenService } from '../../../shared/access-control/access-token.service.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { IdentityService } from '../../../shared/identity/identity.service.js';
import type { User } from '../../../shared/identity/user.js';
import type { ModuleLogger } from '../../../shared/http/module-logger.js';
import type { RateLimitService } from '../../../shared/rate-limit/rate-limit.service.js';
import { RATE_LIMITS } from '../auth.rate-limits.js';
import type { OutboxRepository } from '../../../shared/outbox/outbox.repository.js';
import type { TransactionRunner } from '../../../shared/database/transaction-runner.js';
import { AuthService } from './auth.service.js';
import type { VerificationTokenService } from '../../../shared/verification/verification-token.service.js';

const env = {
	WEB_ORIGIN: 'https://app.example.com',
	AUTH_EMAIL_VERIFICATION_TTL: 86400,
	AUTH_PASSWORD_RESET_TTL: 3600,
} as Env;

type Mock = ReturnType<typeof vi.fn>;

const EXECUTOR = Symbol('executor');

let records: Record<string, unknown>[];

function recordingLogger(): ModuleLogger {
	return pino(
		{ level: 'debug' },
		{
			write: (line: string) => {
				records.push(JSON.parse(line) as Record<string, unknown>);
			},
		},
	).child({ module: 'auth' });
}

interface IdentityMock {
	register: Mock;
	authenticate: Mock;
	lockRotation: Mock;
	rotateSession: Mock;
	revokeSession: Mock;
	findById: Mock;
	findByEmail: Mock;
	markEmailVerified: Mock;
	changePassword: Mock;
	setLocale: Mock;
	startSession: Mock;
}

const LOCKED = {
	familyId: 'family-1',
	userId: 'user-1',
	accountId: 'account-1',
	tokenHash: 'hash-1',
	spentAt: null,
	expiresAt: new Date('2026-06-01T00:00:00.000Z'),
	revokedAt: null,
};

function account(overrides: Partial<User> = {}): User {
	return {
		id: 'acc-1',
		accountId: 'account-1',
		role: 'owner',
		email: 'ada@example.com',
		locale: 'pt-BR',
		emailVerifiedAt: new Date('2026-01-02T00:00:00.000Z'),
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	} as User;
}

describe('AuthService', () => {
	let identity: IdentityMock;
	let accessTokens: { issue: Mock; ttlSeconds: number };
	let verificationTokens: { issue: Mock; redeem: Mock };
	let rateLimit: { consume: Mock };
	let outbox: { enqueue: Mock };
	let transactions: { runAsSystem: Mock; runInAccount: Mock; runInDiscoveredAccount: Mock };
	let service: AuthService;

	beforeEach(() => {
		identity = {
			register: vi.fn().mockResolvedValue({ kind: 'registered', user: account() }),
			authenticate: vi.fn().mockResolvedValue(account()),
			lockRotation: vi.fn().mockResolvedValue(LOCKED),
			rotateSession: vi.fn(),
			revokeSession: vi.fn().mockResolvedValue(undefined),
			findById: vi.fn().mockResolvedValue(account()),
			findByEmail: vi.fn().mockResolvedValue(account()),
			markEmailVerified: vi.fn().mockResolvedValue(undefined),
			changePassword: vi.fn().mockResolvedValue(undefined),
			setLocale: vi.fn().mockResolvedValue(undefined),
			startSession: vi.fn().mockResolvedValue({
				sessionId: 'sess-1',
				refreshToken: 'refresh-1',
				expiresAt: new Date('2026-02-01T00:00:00.000Z'),
			}),
		};
		accessTokens = { issue: vi.fn().mockResolvedValue('access-1'), ttlSeconds: 900 };
		verificationTokens = {
			issue: vi.fn().mockResolvedValue({ token: 'tok-1', expiresAt: new Date() }),
			redeem: vi.fn().mockResolvedValue({ userId: 'user-1', accountId: 'account-1' }),
		};
		rateLimit = { consume: vi.fn().mockResolvedValue(undefined) };
		outbox = { enqueue: vi.fn().mockResolvedValue(undefined) };
		transactions = {
			runAsSystem: vi.fn((work: (executor: unknown) => Promise<unknown>) => work(EXECUTOR)),
			runInAccount: vi.fn((_accountId: string, work: (executor: unknown) => Promise<unknown>) =>
				work(EXECUTOR),
			),
			runInDiscoveredAccount: vi.fn(
				async (
					discover: (executor: unknown) => Promise<unknown>,
					work: (discovered: unknown, executor: unknown) => Promise<unknown>,
				) => {
					const discovered = await discover(EXECUTOR);
					return discovered ? work(discovered, EXECUTOR) : undefined;
				},
			),
		};

		records = [];
		service = new AuthService(
			recordingLogger(),
			identity as unknown as IdentityService,
			new FixedClock(new Date('2026-05-01T00:00:00.000Z')),
			env,
			accessTokens as unknown as AccessTokenService,
			verificationTokens as unknown as VerificationTokenService,
			rateLimit as unknown as RateLimitService,
			outbox as unknown as OutboxRepository,
			transactions as unknown as TransactionRunner,
		);
	});

	describe('register', () => {
		it('rate limits before it touches identity', async () => {
			await service.register('ada@example.com', 'pw', 'pt-BR');
			expect(rateLimit.consume).toHaveBeenCalledWith(RATE_LIMITS.register, 'ada@example.com');
		});

		it('queues a verification for a new account and issues no token itself', async () => {
			await service.register('ada@example.com', 'pw', 'pt-BR');

			expect(outbox.enqueue).toHaveBeenCalledWith(
				'account-1',
				{
					kind: 'auth.verification',
					userId: 'acc-1',
				},
				EXECUTOR,
			);
			expect(verificationTokens.issue).not.toHaveBeenCalled();
		});

		it('says and does nothing different when the address is taken', async () => {
			identity.register.mockResolvedValue({ kind: 'email_taken' });

			await expect(service.register('ada@example.com', 'pw', 'pt-BR')).resolves.toBeUndefined();
			expect(outbox.enqueue).not.toHaveBeenCalled();
		});

		it('files what it swallowed under the module that swallowed it', async () => {
			identity.register.mockResolvedValue({ kind: 'email_taken' });

			await service.register('ada@example.com', 'pw', 'pt-BR');

			expect(records).toContainEqual(
				expect.objectContaining({
					module: 'auth',
					context: 'AuthService',
					event: 'register.duplicate',
				}),
			);
		});
	});

	describe('login', () => {
		it('rate limits before it checks the password', async () => {
			await service.login('ada@example.com', 'pw');
			expect(rateLimit.consume).toHaveBeenCalledWith(RATE_LIMITS.login, 'ada@example.com');
		});

		it('rejects a wrong password and a missing account identically', async () => {
			identity.authenticate.mockResolvedValue(null);

			try {
				await service.login('ada@example.com', 'pw');
				expect.unreachable('should have thrown');
			} catch (error) {
				expect((error as AppError).code).toBe('INVALID_CREDENTIALS');
			}
		});

		it('refuses an unverified account', async () => {
			identity.authenticate.mockResolvedValue(account({ emailVerifiedAt: null }));

			try {
				await service.login('ada@example.com', 'pw');
				expect.unreachable('should have thrown');
			} catch (error) {
				expect((error as AppError).code).toBe('EMAIL_NOT_VERIFIED');
			}
			expect(identity.startSession).not.toHaveBeenCalled();
		});

		it('issues a session carrying the access token and the refresh cookie material', async () => {
			const issued = await service.login('ada@example.com', 'pw');

			expect(issued.refreshToken).toBe('refresh-1');
			expect(issued.refreshExpiresAt).toEqual(new Date('2026-02-01T00:00:00.000Z'));
			expect(issued.response).toMatchObject({ accessToken: 'access-1', expiresIn: 900 });
			expect(issued.response.user).toMatchObject({ id: 'acc-1', emailVerified: true });
		});

		it('puts the verification state into the access token claims', async () => {
			await service.login('ada@example.com', 'pw');

			expect(accessTokens.issue).toHaveBeenCalledWith({
				userId: 'acc-1',
				accountId: 'account-1',
				role: 'owner',
				sessionId: 'sess-1',
				emailVerified: true,
			});
		});

		it('carries the account and the role, so the kernel can scope without a lookup', async () => {
			await service.login('ada@example.com', 'pw');

			expect(accessTokens.issue.mock.calls[0]?.[0]).toMatchObject({
				accountId: 'account-1',
				role: 'owner',
			});
		});
	});

	describe('refresh', () => {
		function rotated() {
			identity.rotateSession.mockResolvedValue({
				kind: 'rotated',
				session: {
					accountId: 'account-1',
					sessionId: 'sess-2',
					refreshToken: 'refresh-2',
					expiresAt: new Date('2026-03-01T00:00:00.000Z'),
				},
			});
		}

		it('holds system privilege for the lookup only, never for the rotation', async () => {
			rotated();
			await service.refresh('refresh-1');

			expect(transactions.runInDiscoveredAccount).toHaveBeenCalledTimes(1);
			expect(transactions.runAsSystem).not.toHaveBeenCalled();
		});

		it('discovers the account from the token, since the request carries no claim', async () => {
			rotated();
			await service.refresh('refresh-1');

			const discover = transactions.runInDiscoveredAccount.mock.calls[0]?.[0] as (
				executor: unknown,
			) => Promise<unknown>;
			await discover(EXECUTOR);

			expect(identity.lockRotation).toHaveBeenCalledWith('refresh-1', EXECUTOR);
		});

		it('spends and reissues under the account the lookup found', async () => {
			rotated();
			await service.refresh('refresh-1');

			expect(identity.rotateSession).toHaveBeenCalledWith(LOCKED, EXECUTOR);
		});

		it('revokes the family and reports reuse when a token is replayed', async () => {
			identity.rotateSession.mockResolvedValue({ kind: 'reuse_detected', sessionId: 'sess-1' });

			try {
				await service.refresh('refresh-1');
				expect.unreachable('should have thrown');
			} catch (error) {
				expect((error as AppError).code).toBe('SESSION_REUSE_DETECTED');
			}
		});

		it('lets the family revocation commit before it reports the reuse', async () => {
			identity.rotateSession.mockResolvedValue({ kind: 'reuse_detected', sessionId: 'sess-1' });

			await expect(service.refresh('refresh-1')).rejects.toBeInstanceOf(AppError);
			await expect(transactions.runInDiscoveredAccount.mock.results[0]?.value).resolves.toEqual({
				outcome: { kind: 'reuse_detected', sessionId: 'sess-1' },
				user: null,
			});
		});

		it('rejects a token no family answers to', async () => {
			identity.lockRotation.mockResolvedValue(undefined);

			try {
				await service.refresh('refresh-1');
				expect.unreachable('should have thrown');
			} catch (error) {
				expect((error as AppError).code).toBe('UNAUTHENTICATED');
			}

			expect(identity.rotateSession).not.toHaveBeenCalled();
		});

		it('rejects a token the rotation does not recognise', async () => {
			identity.rotateSession.mockResolvedValue({ kind: 'rejected' });

			try {
				await service.refresh('refresh-1');
				expect.unreachable('should have thrown');
			} catch (error) {
				expect((error as AppError).code).toBe('UNAUTHENTICATED');
			}
		});

		it('rejects a live session whose user has since vanished', async () => {
			rotated();
			identity.findById.mockResolvedValue(null);

			await expect(service.refresh('refresh-1')).rejects.toBeInstanceOf(AppError);
		});

		it('returns the rotated refresh token, not the one it was given', async () => {
			rotated();

			const issued = await service.refresh('refresh-1');

			expect(issued.refreshToken).toBe('refresh-2');
			expect(accessTokens.issue).toHaveBeenCalledWith(
				expect.objectContaining({ sessionId: 'sess-2' }),
			);
		});
	});

	describe('logout', () => {
		it('revokes the session behind the token', async () => {
			await service.logout('refresh-1');
			expect(identity.revokeSession).toHaveBeenCalledWith('refresh-1');
		});

		it('is a no-op without a token, so a logout with no cookie still succeeds', async () => {
			await expect(service.logout(undefined)).resolves.toBeUndefined();
			expect(identity.revokeSession).not.toHaveBeenCalled();
		});
	});

	describe('verifyEmail', () => {
		it('marks the account verified and welcomes it', async () => {
			await service.verifyEmail('tok-1');

			expect(verificationTokens.redeem).toHaveBeenCalledWith(
				'tok-1',
				'email_verification',
				EXECUTOR,
			);
			expect(identity.markEmailVerified).toHaveBeenCalledWith('user-1', EXECUTOR);
			expect(outbox.enqueue).toHaveBeenCalledWith(
				'account-1',
				{ kind: 'auth.welcome', userId: 'user-1' },
				EXECUTOR,
			);
		});

		it('does not reload the account: the worker resolves it when it sends', async () => {
			await service.verifyEmail('tok-1');

			expect(identity.markEmailVerified).toHaveBeenCalledWith('user-1', EXECUTOR);
			expect(identity.findById).not.toHaveBeenCalled();
		});
	});

	describe('resendVerification', () => {
		it('rate limits the address', async () => {
			identity.findByEmail.mockResolvedValue(account({ emailVerifiedAt: null }));
			await service.resendVerification('ada@example.com');

			expect(rateLimit.consume).toHaveBeenCalledWith(
				RATE_LIMITS.resendVerification,
				'ada@example.com',
			);
		});

		it('sends nothing for an address with no account', async () => {
			identity.findByEmail.mockResolvedValue(null);

			await expect(service.resendVerification('nobody@example.com')).resolves.toBeUndefined();
			expect(outbox.enqueue).not.toHaveBeenCalled();
		});

		it('sends nothing for an account that is already verified', async () => {
			await service.resendVerification('ada@example.com');
			expect(outbox.enqueue).not.toHaveBeenCalled();
		});

		it('issues a fresh token for an unverified account', async () => {
			identity.findByEmail.mockResolvedValue(account({ emailVerifiedAt: null }));

			await service.resendVerification('ada@example.com');

			expect(outbox.enqueue).toHaveBeenCalledWith('account-1', {
				kind: 'auth.verification',
				userId: 'acc-1',
			});
		});
	});

	describe('forgotPassword', () => {
		it('rate limits the address', async () => {
			await service.forgotPassword('ada@example.com');
			expect(rateLimit.consume).toHaveBeenCalledWith(RATE_LIMITS.forgotPassword, 'ada@example.com');
		});

		it('sends nothing for an unknown address, and says so to nobody', async () => {
			identity.findByEmail.mockResolvedValue(null);

			await expect(service.forgotPassword('nobody@example.com')).resolves.toBeUndefined();
			expect(outbox.enqueue).not.toHaveBeenCalled();
		});

		it('queues a reset without issuing the token, which never reaches the outbox', async () => {
			await service.forgotPassword('ada@example.com');

			expect(verificationTokens.issue).not.toHaveBeenCalled();
			expect(outbox.enqueue).toHaveBeenCalledWith('account-1', {
				kind: 'auth.password_reset',
				userId: 'acc-1',
			});
		});
	});

	describe('resetPassword', () => {
		it('redeems the token, changes the password and warns the account', async () => {
			await service.resetPassword('tok-1', 'new-password');

			expect(verificationTokens.redeem).toHaveBeenCalledWith('tok-1', 'password_reset', EXECUTOR);
			expect(identity.changePassword).toHaveBeenCalledWith('user-1', 'new-password', EXECUTOR);
			expect(outbox.enqueue).toHaveBeenCalledWith(
				'account-1',
				{
					kind: 'auth.password_changed',
					userId: 'user-1',
					changedAt: '2026-05-01T00:00:00.000Z',
				},
				EXECUTOR,
			);
		});

		it('does not reload the account: the worker resolves it when it sends', async () => {
			await service.resetPassword('tok-1', 'new-password');

			expect(identity.changePassword).toHaveBeenCalled();
			expect(identity.findById).not.toHaveBeenCalled();
		});
	});

	describe('currentUser and setLocale', () => {
		it('maps the account onto the wire shape', async () => {
			expect(await service.currentUser('acc-1')).toMatchObject({
				id: 'acc-1',
				email: 'ada@example.com',
				emailVerified: true,
			});
		});

		it('rejects when the account is gone', async () => {
			identity.findById.mockResolvedValue(null);
			await expect(service.currentUser('acc-1')).rejects.toBeInstanceOf(AppError);
		});

		it('persists the locale and returns the updated user', async () => {
			identity.findById.mockResolvedValue(account({ locale: 'en' }));

			const user = await service.setLocale('acc-1', 'en');

			expect(identity.setLocale).toHaveBeenCalledWith('acc-1', 'en');
			expect(user.locale).toBe('en');
		});
	});
});
