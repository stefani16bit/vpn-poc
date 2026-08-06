import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { AppError } from '../errors/app-error.js';
import type { AccessTokenClaims } from './access-token.service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { currentAuth } from './current-auth.decorator.js';

function contextFor(request: Partial<AuthenticatedRequest>): ExecutionContext {
	return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

const CLAIMS: AccessTokenClaims = {
	accountId: 'acc-1',
	sessionId: 'sess-1',
	emailVerified: true,
};

describe('currentAuth', () => {
	it('returns the claims the guard attached to the request', () => {
		expect(currentAuth(undefined, contextFor({ auth: CLAIMS }))).toEqual(CLAIMS);
	});

	it('fails loudly when the route has no guard, rather than returning undefined', () => {
		try {
			currentAuth(undefined, contextFor({}));
			expect.unreachable('should have thrown');
		} catch (error) {
			expect(error).toBeInstanceOf(AppError);
			expect((error as AppError).code).toBe('INTERNAL');
		}
	});
});
