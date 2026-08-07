import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { runWithContext } from '../../../shared/http/request-context.js';
import type { AuthService } from '../services/auth.service.js';
import { AuthController } from './auth.controller.js';
import type { RefreshCookie } from './refresh-cookie.js';

const CLAIMS: AccessTokenClaims = {
	accountId: 'acc-1',
	role: 'owner' as const,
	userId: 'user-1',
	sessionId: 'sess-1',
	emailVerified: true,
};

const USER = {
	id: 'acc-1',
	email: 'ada@example.com',
	emailVerified: true,
	locale: 'pt-BR',
	createdAt: '2026-01-01T00:00:00.000Z',
} as const;

const ISSUED = {
	response: { user: USER, accessToken: 'access-1', expiresIn: 900 },
	refreshToken: 'refresh-1',
	refreshExpiresAt: new Date('2026-02-01T00:00:00.000Z'),
};

type Mock = ReturnType<typeof vi.fn>;

interface AuthMock {
	register: Mock;
	login: Mock;
	refresh: Mock;
	logout: Mock;
	verifyEmail: Mock;
	resendVerification: Mock;
	forgotPassword: Mock;
	resetPassword: Mock;
	currentUser: Mock;
	setLocale: Mock;
}

interface CookieMock {
	read: Mock;
	set: Mock;
	clear: Mock;
}

describe('AuthController', () => {
	let auth: AuthMock;
	let cookie: CookieMock;
	let controller: AuthController;
	let response: Response;

	beforeEach(() => {
		auth = {
			register: vi.fn().mockResolvedValue(undefined),
			login: vi.fn().mockResolvedValue(ISSUED),
			refresh: vi.fn().mockResolvedValue(ISSUED),
			logout: vi.fn().mockResolvedValue(undefined),
			verifyEmail: vi.fn().mockResolvedValue(undefined),
			resendVerification: vi.fn().mockResolvedValue(undefined),
			forgotPassword: vi.fn().mockResolvedValue(undefined),
			resetPassword: vi.fn().mockResolvedValue(undefined),
			currentUser: vi.fn().mockResolvedValue(USER),
			setLocale: vi.fn().mockResolvedValue(USER),
		};
		cookie = {
			read: vi.fn().mockReturnValue('refresh-1'),
			set: vi.fn(),
			clear: vi.fn(),
		};
		controller = new AuthController(
			auth as unknown as AuthService,
			cookie as unknown as RefreshCookie,
		);
		response = {} as Response;
	});

	describe('register', () => {
		it('passes the locale the body asked for', async () => {
			await controller.register({ email: 'ada@example.com', password: 'pw', locale: 'en' });

			expect(auth.register).toHaveBeenCalledWith('ada@example.com', 'pw', 'en');
		});

		it('falls back to the negotiated locale when the body omits one', async () => {
			await runWithContext({ correlationId: 'c', locale: 'en', module: 'system' }, async () => {
				await controller.register({ email: 'ada@example.com', password: 'pw' });
			});

			expect(auth.register).toHaveBeenCalledWith('ada@example.com', 'pw', 'en');
		});

		it('acknowledges without revealing whether the address was new', async () => {
			expect(await controller.register({ email: 'ada@example.com', password: 'pw' })).toEqual({
				acknowledged: true,
			});
		});
	});

	describe('login', () => {
		it('sets the refresh cookie from the issued session', async () => {
			const body = await controller.login({ email: 'ada@example.com', password: 'pw' }, response);

			expect(cookie.set).toHaveBeenCalledWith(response, 'refresh-1', ISSUED.refreshExpiresAt);
			expect(body).toEqual(ISSUED.response);
		});
	});

	describe('refresh', () => {
		it('rejects a request with no session cookie before calling the service', async () => {
			cookie.read.mockReturnValue(undefined);

			try {
				await controller.refresh({} as Request, response);
				expect.unreachable('should have thrown');
			} catch (error) {
				expect((error as AppError).code).toBe('UNAUTHENTICATED');
			}
			expect(auth.refresh).not.toHaveBeenCalled();
		});

		it('rotates the cookie with the newly issued token', async () => {
			const body = await controller.refresh({} as Request, response);

			expect(auth.refresh).toHaveBeenCalledWith('refresh-1');
			expect(cookie.set).toHaveBeenCalledWith(response, 'refresh-1', ISSUED.refreshExpiresAt);
			expect(body).toEqual(ISSUED.response);
		});
	});

	describe('logout', () => {
		it('revokes the session and clears the cookie', async () => {
			expect(await controller.logout({} as Request, response)).toEqual({ acknowledged: true });

			expect(auth.logout).toHaveBeenCalledWith('refresh-1');
			expect(cookie.clear).toHaveBeenCalledWith(response);
		});

		it('clears the cookie even when there was no session to revoke', async () => {
			cookie.read.mockReturnValue(undefined);

			await controller.logout({} as Request, response);

			expect(auth.logout).toHaveBeenCalledWith(undefined);
			expect(cookie.clear).toHaveBeenCalledWith(response);
		});
	});

	describe('the remaining routes', () => {
		it('acknowledges a verification', async () => {
			expect(await controller.verifyEmail({ token: 'tok' })).toEqual({ acknowledged: true });
			expect(auth.verifyEmail).toHaveBeenCalledWith('tok');
		});

		it('acknowledges a resend without revealing the address', async () => {
			expect(await controller.resendVerification({ email: 'ada@example.com' })).toEqual({
				acknowledged: true,
			});
		});

		it('acknowledges forgot-password without revealing the address', async () => {
			expect(await controller.forgotPassword({ email: 'nobody@example.com' })).toEqual({
				acknowledged: true,
			});
		});

		it('clears the session cookie after a password reset', async () => {
			expect(await controller.resetPassword({ token: 'tok', password: 'pw' }, response)).toEqual({
				acknowledged: true,
			});

			expect(auth.resetPassword).toHaveBeenCalledWith('tok', 'pw');
			expect(cookie.clear).toHaveBeenCalledWith(response);
		});

		it('returns the current user for the person the token names', async () => {
			expect(await controller.me(CLAIMS)).toEqual(USER);
			expect(auth.currentUser).toHaveBeenCalledWith('user-1');
		});

		it('updates the locale of the person the token names, not the account', async () => {
			expect(await controller.updateLocale(CLAIMS, { locale: 'en' })).toEqual(USER);
			expect(auth.setLocale).toHaveBeenCalledWith('user-1', 'en');
		});
	});
});
