import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '@vpn-poc/env';
import { FixedClock, MemorySecretStore } from '@vpn/testing/fakes';

import { AppError } from '../errors/app-error.js';
import { AccessTokenService } from './access-token.service.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { ALLOW_UNVERIFIED } from './allow-unverified.decorator.js';
import type { AuthenticatedRequest } from './authenticated-request.js';

const SECRET = 'a-secret-that-is-at-least-32-characters-long';

// The guard reaches Env only through AccessTokenService, which reads two fields.
const REF = 'poc-vpn/auth/jwt-secret';
const env = { AUTH_JWT_SECRET_REF: REF, AUTH_ACCESS_TOKEN_TTL: 900 } as Env;

function contextFor(request: Partial<AuthenticatedRequest>, handler: () => void): ExecutionContext {
	return {
		switchToHttp: () => ({ getRequest: () => request }),
		getHandler: () => handler,
		getClass: () => class {},
	} as unknown as ExecutionContext;
}

async function codeOf(run: Promise<unknown>): Promise<string> {
	try {
		await run;
		expect.unreachable('should have thrown');
	} catch (error) {
		expect(error).toBeInstanceOf(AppError);
		return (error as AppError).code;
	}
}

describe('AccessTokenGuard', () => {
	let tokens: AccessTokenService;
	let guard: AccessTokenGuard;
	let reflector: Reflector;

	function unverifiedHandler(): void {}
	function plainHandler(): void {}

	beforeEach(() => {
		// jose validates exp against wall time; see access-token.service.spec.ts.
		tokens = new AccessTokenService(
			env,
			new FixedClock(new Date()),
			new MemorySecretStore({ [REF]: SECRET }),
		);
		reflector = new Reflector();
		guard = new AccessTokenGuard(tokens, reflector);

		Reflect.defineMetadata(ALLOW_UNVERIFIED, true, unverifiedHandler);
	});

	it('rejects a request with no authorization header', async () => {
		const context = contextFor({ headers: {} }, plainHandler);
		expect(await codeOf(guard.canActivate(context))).toBe('UNAUTHENTICATED');
	});

	it('rejects an authorization header that is not a Bearer token', async () => {
		const context = contextFor({ headers: { authorization: 'Basic abc' } }, plainHandler);
		expect(await codeOf(guard.canActivate(context))).toBe('UNAUTHENTICATED');
	});

	it('rejects a Bearer token that does not verify', async () => {
		const context = contextFor({ headers: { authorization: 'Bearer nope' } }, plainHandler);
		expect(await codeOf(guard.canActivate(context))).toBe('TOKEN_INVALID');
	});

	it('admits a verified account and attaches the claims to the request', async () => {
		const token = await tokens.issue({
			accountId: 'acc-1',
			role: 'owner' as const,
			userId: 'user-1',
			sessionId: 'sess-1',
			emailVerified: true,
		});
		const request: Partial<AuthenticatedRequest> = {
			headers: { authorization: `Bearer ${token}` },
		};

		expect(await guard.canActivate(contextFor(request, plainHandler))).toBe(true);
		expect(request.auth).toEqual({
			accountId: 'acc-1',
			role: 'owner' as const,
			userId: 'user-1',
			sessionId: 'sess-1',
			emailVerified: true,
		});
	});

	it('rejects an unverified account on a route with no AllowUnverified', async () => {
		const token = await tokens.issue({
			accountId: 'acc-1',
			role: 'owner' as const,
			userId: 'user-1',
			sessionId: 'sess-1',
			emailVerified: false,
		});
		const context = contextFor({ headers: { authorization: `Bearer ${token}` } }, plainHandler);

		expect(await codeOf(guard.canActivate(context))).toBe('EMAIL_NOT_VERIFIED');
	});

	it('admits an unverified account when the route allows it', async () => {
		const token = await tokens.issue({
			accountId: 'acc-1',
			role: 'owner' as const,
			userId: 'user-1',
			sessionId: 'sess-1',
			emailVerified: false,
		});
		const request: Partial<AuthenticatedRequest> = {
			headers: { authorization: `Bearer ${token}` },
		};

		expect(await guard.canActivate(contextFor(request, unverifiedHandler))).toBe(true);
		expect(request.auth?.emailVerified).toBe(false);
	});

	it('checks the token before it checks verification', async () => {
		const context = contextFor({ headers: { authorization: 'Bearer nope' } }, unverifiedHandler);
		expect(await codeOf(guard.canActivate(context))).toBe('TOKEN_INVALID');
	});
});
