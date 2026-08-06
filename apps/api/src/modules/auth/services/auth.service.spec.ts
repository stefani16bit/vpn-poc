import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '@vpn-poc/env';
import type { Account, IIdentityProvider } from '@vpn/ports';
import { FixedClock } from '@vpn/testing/fakes';

import type { AccessTokenService } from '../../../shared/access-control/access-token.service.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { RateLimitService } from '../../../shared/rate-limit/rate-limit.service.js';
import { RATE_LIMITS } from '../auth.rate-limits.js';
import type { AuthMailer } from './auth-mailer.service.js';
import { AuthService } from './auth.service.js';
import type { VerificationTokenService } from './verification-token.service.js';

const env = {
	WEB_ORIGIN: 'https://app.example.com',
	AUTH_EMAIL_VERIFICATION_TTL: 86400,
	AUTH_PASSWORD_RESET_TTL: 3600,
} as Env;

type Mock = ReturnType<typeof vi.fn>;

interface IdentityMock {
	register: Mock;
	authenticate: Mock;
	refreshSession: Mock;
	revokeSession: Mock;
	findById: Mock;
	findByEmail: Mock;
	markEmailVerified: Mock;
	changePassword: Mock;
	setLocale: Mock;
	startSession: Mock;
}

interface MailerMock {
	sendVerification: Mock;
	sendPasswordReset: Mock;
	sendWelcome: Mock;
	sendPasswordChanged: Mock;
}

function account(overrides: Partial<Account> = {}): Account {
	return {
		id: 'acc-1',
		email: 'ada@example.com',
		locale: 'pt-BR',
		emailVerifiedAt: new Date('2026-01-02T00:00:00.000Z'),
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	} as Account;
}

describe('AuthService', () => {
	let identity: IdentityMock;
	let accessTokens: { issue: Mock; ttlSeconds: number };
	let verificationTokens: { issue: Mock; redeem: Mock };
	let rateLimit: { consume: Mock };
	let mailer: MailerMock;
	let service: AuthService;

	beforeEach(() => {
		identity = {
			register: vi.fn().mockResolvedValue({ kind: 'registered', account: account() }),
			authenticate: vi.fn().mockResolvedValue(account()),
			refreshSession: vi.fn(),
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
			redeem: vi.fn().mockResolvedValue('acc-1'),
		};
		rateLimit = { consume: vi.fn().mockResolvedValue(undefined) };
		mailer = {
			sendVerification: vi.fn().mockResolvedValue(undefined),
			sendPasswordReset: vi.fn().mockResolvedValue(undefined),
			sendWelcome: vi.fn().mockResolvedValue(undefined),
			sendPasswordChanged: vi.fn().mockResolvedValue(undefined),
		};

		service = new AuthService(
			identity as unknown as IIdentityProvider,
			new FixedClock(new Date('2026-05-01T00:00:00.000Z')),
			env,
			accessTokens as unknown as AccessTokenService,
			verificationTokens as unknown as VerificationTokenService,
			rateLimit as unknown as RateLimitService,
			mailer as unknown as AuthMailer,
		);
	});

	describe('register', () => {
		it('rate limits before it touches identity', async () => {
			await service.register('ada@example.com', 'pw', 'pt-BR');
			expect(rateLimit.consume).toHaveBeenCalledWith(RATE_LIMITS.register, 'ada@example.com');
		});

		it('mails a verification token to a new account', async () => {
			await service.register('ada@example.com', 'pw', 'pt-BR');

			expect(verificationTokens.issue).toHaveBeenCalledWith('acc-1', 'email_verification', 86400);
			expect(mailer.sendVerification).toHaveBeenCalledWith(expect.anything(), 'tok-1', 86400);
		});

		it('says and does nothing different when the address is taken', async () => {
			identity.register.mockResolvedValue({ kind: 'email_taken' });

			await expect(service.register('ada@example.com', 'pw', 'pt-BR')).resolves.toBeUndefined();
			expect(mailer.sendVerification).not.toHaveBeenCalled();
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
				accountId: 'acc-1',
				sessionId: 'sess-1',
				emailVerified: true,
			});
		});
	});

	describe('refresh', () => {
		it('revokes the family and reports reuse when a token is replayed', async () => {
			identity.refreshSession.mockResolvedValue({ kind: 'reuse_detected', sessionId: 'sess-1' });

			try {
				await service.refresh('refresh-1');
				expect.unreachable('should have thrown');
			} catch (error) {
				expect((error as AppError).code).toBe('SESSION_REUSE_DETECTED');
			}
		});

		it('rejects a token the provider does not recognise', async () => {
			identity.refreshSession.mockResolvedValue({ kind: 'rejected' });

			try {
				await service.refresh('refresh-1');
				expect.unreachable('should have thrown');
			} catch (error) {
				expect((error as AppError).code).toBe('UNAUTHENTICATED');
			}
		});

		it('rejects a live session whose account has since vanished', async () => {
			identity.refreshSession.mockResolvedValue({
				kind: 'rotated',
				session: {
					accountId: 'acc-1',
					sessionId: 'sess-2',
					refreshToken: 'refresh-2',
					expiresAt: new Date(),
				},
			});
			identity.findById.mockResolvedValue(null);

			await expect(service.refresh('refresh-1')).rejects.toBeInstanceOf(AppError);
		});

		it('returns the rotated refresh token, not the one it was given', async () => {
			identity.refreshSession.mockResolvedValue({
				kind: 'rotated',
				session: {
					accountId: 'acc-1',
					sessionId: 'sess-2',
					refreshToken: 'refresh-2',
					expiresAt: new Date('2026-03-01T00:00:00.000Z'),
				},
			});

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

			expect(verificationTokens.redeem).toHaveBeenCalledWith('tok-1', 'email_verification');
			expect(identity.markEmailVerified).toHaveBeenCalledWith('acc-1');
			expect(mailer.sendWelcome).toHaveBeenCalled();
		});

		it('still marks verified when the account cannot be reloaded', async () => {
			identity.findById.mockResolvedValue(null);

			await service.verifyEmail('tok-1');

			expect(identity.markEmailVerified).toHaveBeenCalledWith('acc-1');
			expect(mailer.sendWelcome).not.toHaveBeenCalled();
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
			expect(mailer.sendVerification).not.toHaveBeenCalled();
		});

		it('sends nothing for an account that is already verified', async () => {
			await service.resendVerification('ada@example.com');
			expect(mailer.sendVerification).not.toHaveBeenCalled();
		});

		it('issues a fresh token for an unverified account', async () => {
			identity.findByEmail.mockResolvedValue(account({ emailVerifiedAt: null }));

			await service.resendVerification('ada@example.com');

			expect(mailer.sendVerification).toHaveBeenCalledWith(expect.anything(), 'tok-1', 86400);
		});
	});

	describe('forgotPassword', () => {
		it('rate limits the address', async () => {
			await service.forgotPassword('ada@example.com');
			expect(rateLimit.consume).toHaveBeenCalledWith(
				RATE_LIMITS.forgotPassword,
				'ada@example.com',
			);
		});

		it('sends nothing for an unknown address, and says so to nobody', async () => {
			identity.findByEmail.mockResolvedValue(null);

			await expect(service.forgotPassword('nobody@example.com')).resolves.toBeUndefined();
			expect(mailer.sendPasswordReset).not.toHaveBeenCalled();
		});

		it('issues a reset token on the reset ttl', async () => {
			await service.forgotPassword('ada@example.com');

			expect(verificationTokens.issue).toHaveBeenCalledWith('acc-1', 'password_reset', 3600);
			expect(mailer.sendPasswordReset).toHaveBeenCalledWith(expect.anything(), 'tok-1', 3600);
		});
	});

	describe('resetPassword', () => {
		it('redeems the token, changes the password and warns the account', async () => {
			await service.resetPassword('tok-1', 'new-password');

			expect(verificationTokens.redeem).toHaveBeenCalledWith('tok-1', 'password_reset');
			expect(identity.changePassword).toHaveBeenCalledWith('acc-1', 'new-password');
			expect(mailer.sendPasswordChanged).toHaveBeenCalled();
		});

		it('still changes the password when the account cannot be reloaded', async () => {
			identity.findById.mockResolvedValue(null);

			await service.resetPassword('tok-1', 'new-password');

			expect(identity.changePassword).toHaveBeenCalled();
			expect(mailer.sendPasswordChanged).not.toHaveBeenCalled();
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
