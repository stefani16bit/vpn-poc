import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '@vpn-poc/env';
import { FixedClock } from '@vpn/testing/fakes';

import { AppError } from '../errors/app-error.js';
import { AccessTokenService } from './access-token.service.js';

const SECRET = 'a-secret-that-is-at-least-32-characters-long';
const CLAIMS = { accountId: 'acc-1', sessionId: 'sess-1', emailVerified: true };

// AccessTokenService reads exactly two fields off Env; the cast avoids building
// the other forty, which say nothing about this unit.
const env = { AUTH_JWT_SECRET: SECRET, AUTH_ACCESS_TOKEN_TTL: 900 } as Env;

function signWith(overrides: { issuer?: string; audience?: string }): Promise<string> {
	return new SignJWT({ sid: CLAIMS.sessionId, ev: true })
		.setProtectedHeader({ alg: 'HS256' })
		.setSubject(CLAIMS.accountId)
		.setIssuer(overrides.issuer ?? 'poc-vpn')
		.setAudience(overrides.audience ?? 'poc-vpn-api')
		.setIssuedAt()
		.setExpirationTime('5m')
		.sign(new TextEncoder().encode(SECRET));
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

describe('AccessTokenService', () => {
	let clock: FixedClock;
	let service: AccessTokenService;

	beforeEach(() => {
		// jose validates exp against wall time, so the issuing clock has to agree
		// with it; FixedClock's own epoch would make every token born expired.
		clock = new FixedClock(new Date());
		service = new AccessTokenService(env, clock);
	});

	it('round-trips the claims it issued', async () => {
		const token = await service.issue(CLAIMS);
		expect(await service.verify(token)).toEqual(CLAIMS);
	});

	it('carries emailVerified false through the round trip', async () => {
		const token = await service.issue({ ...CLAIMS, emailVerified: false });
		expect((await service.verify(token)).emailVerified).toBe(false);
	});

	it('rejects a token signed with the right secret but a foreign issuer', async () => {
		const token = await signWith({ issuer: 'someone-else' });
		expect(await codeOf(service.verify(token))).toBe('TOKEN_INVALID');
	});

	it('rejects a token signed with the right secret but a foreign audience', async () => {
		const token = await signWith({ audience: 'another-api' });
		expect(await codeOf(service.verify(token))).toBe('TOKEN_INVALID');
	});

	it('reports an expired token as TOKEN_EXPIRED, not TOKEN_INVALID', async () => {
		clock.set(new Date(Date.now() - 2 * 900 * 1000));
		const token = await service.issue(CLAIMS);

		expect(await codeOf(service.verify(token))).toBe('TOKEN_EXPIRED');
	});

	it('rejects a token signed with a different secret', async () => {
		const token = await new SignJWT({ sid: 'sess-1', ev: true })
			.setProtectedHeader({ alg: 'HS256' })
			.setSubject('acc-1')
			.setIssuer('poc-vpn')
			.setAudience('poc-vpn-api')
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(new TextEncoder().encode('a-completely-different-secret-of-length'));

		expect(await codeOf(service.verify(token))).toBe('TOKEN_INVALID');
	});

	it('rejects a well-formed token that is missing the session claim', async () => {
		const token = await new SignJWT({ ev: true })
			.setProtectedHeader({ alg: 'HS256' })
			.setSubject('acc-1')
			.setIssuer('poc-vpn')
			.setAudience('poc-vpn-api')
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(new TextEncoder().encode(SECRET));

		expect(await codeOf(service.verify(token))).toBe('TOKEN_INVALID');
	});

	it('rejects a value that is not a token at all', async () => {
		expect(await codeOf(service.verify('not-a-jwt'))).toBe('TOKEN_INVALID');
	});

	it('exposes the configured ttl', () => {
		expect(service.ttlSeconds).toBe(900);
	});
});
