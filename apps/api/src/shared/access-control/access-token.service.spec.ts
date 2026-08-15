import { SignJWT } from 'jose';
import { beforeEach, describe, expect, it } from 'vitest';

import type { Env } from '@vpn-poc/env';
import { FixedClock, MemorySecretStore } from '@vpn/testing/fakes';

import { AppError } from '../errors/app-error.js';
import { AccessTokenService } from './access-token.service.js';

const REF = 'poc-vpn/auth/jwt-secret';
const SECRET = 'a-secret-that-is-at-least-32-characters-long';
const CLAIMS = {
	accountId: 'acc-1',
	role: 'owner' as const,
	userId: 'user-1',
	sessionId: 'sess-1',
	emailVerified: true,
};

// AccessTokenService reads exactly two fields off Env; the cast avoids building
// the other forty, which say nothing about this unit.
const env = { AUTH_JWT_SECRET_REF: REF, AUTH_ACCESS_TOKEN_TTL: 900 } as Env;

function signWith(
	overrides: { issuer?: string; audience?: string; secret?: string } = {},
): Promise<string> {
	return new SignJWT({ sid: CLAIMS.sessionId, ev: true, acc: CLAIMS.accountId, rol: CLAIMS.role })
		.setProtectedHeader({ alg: 'HS256' })
		.setSubject(CLAIMS.userId)
		.setIssuer(overrides.issuer ?? 'poc-vpn')
		.setAudience(overrides.audience ?? 'poc-vpn-api')
		.setIssuedAt()
		.setExpirationTime('5m')
		.sign(new TextEncoder().encode(overrides.secret ?? SECRET));
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
	let secrets: MemorySecretStore;
	let service: AccessTokenService;

	beforeEach(() => {
		// jose validates exp against wall time, so the issuing clock has to agree
		// with it; FixedClock's own epoch would make every token born expired.
		clock = new FixedClock(new Date());
		secrets = new MemorySecretStore({ [REF]: SECRET });
		service = new AccessTokenService(env, clock, secrets);
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
		const token = await signWith({ secret: 'a-completely-different-secret-of-length' });

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

	// The whole reason the port carries a window: a rotation used to invalidate
	// every token in circulation at once, and an access token is not revocable,
	// so everybody fell out of whatever they were doing at the same instant.
	describe('the rotation window', () => {
		it('still accepts a token issued before the rotation', async () => {
			const before = await service.issue(CLAIMS);
			secrets.seed(REF, 'the-secret-that-replaced-the-first-one');

			expect(await service.verify(before)).toEqual(CLAIMS);
		});

		it('signs with the current value, so a new token survives the next rotation', async () => {
			secrets.seed(REF, 'the-secret-that-replaced-the-first-one');
			const after = await service.issue(CLAIMS);
			secrets.seed(REF, 'a-third-secret-of-a-perfectly-fine-length');

			expect(await service.verify(after)).toEqual(CLAIMS);
		});

		// The assertion that gives the window an end. Without it "accepts two" and
		// "accepts everything it has ever signed with" behave identically, and a
		// secret somebody rotated away from because they suspected it keeps working.
		it('rejects a token signed with a value two rotations back', async () => {
			const oldest = await service.issue(CLAIMS);
			secrets.seed(REF, 'the-secret-that-replaced-the-first-one');
			secrets.seed(REF, 'a-third-secret-of-a-perfectly-fine-length');

			expect(await codeOf(service.verify(oldest))).toBe('TOKEN_INVALID');
		});

		// A fallback that only re-checks the signature drops issuer and audience
		// without anything going red, and then a token minted by any system that
		// shared the retired secret walks in.
		it('still checks the issuer on the previous value', async () => {
			const token = await signWith({ issuer: 'someone-else' });
			secrets.seed(REF, 'the-secret-that-replaced-the-first-one');

			expect(await codeOf(service.verify(token))).toBe('TOKEN_INVALID');
		});

		it('still checks the audience on the previous value', async () => {
			const token = await signWith({ audience: 'another-api' });
			secrets.seed(REF, 'the-secret-that-replaced-the-first-one');

			expect(await codeOf(service.verify(token))).toBe('TOKEN_INVALID');
		});

		// Expiry does not depend on which key signed it. Falling through to the
		// previous value turns "your session ran out" into "your token is not
		// valid", which is the one message that sends a user to support.
		it('reports an expired token as expired even with a window open', async () => {
			clock.set(new Date(Date.now() - 2 * 900 * 1000));
			const token = await service.issue(CLAIMS);
			clock.set(new Date());
			secrets.seed(REF, 'the-secret-that-replaced-the-first-one');

			expect(await codeOf(service.verify(token))).toBe('TOKEN_EXPIRED');
		});
	});

	describe('where the secret comes from', () => {
		// The negative that proves item 1 landed: with the retired environment
		// variable set to something else entirely, it has no say.
		it('signs with the store, not with AUTH_JWT_SECRET in the environment', async () => {
			const decoy = { ...env, AUTH_JWT_SECRET: 'a-decoy-secret-of-at-least-32-chars' } as Env;
			const withDecoy = new AccessTokenService(decoy, clock, secrets);

			const token = await withDecoy.issue(CLAIMS);

			expect(await service.verify(token)).toEqual(CLAIMS);
		});

		it('refuses to sign when the ref resolves to nothing', async () => {
			const empty = new AccessTokenService(env, clock, new MemorySecretStore());

			expect(await codeOf(empty.issue(CLAIMS))).toBe('INTERNAL');
		});

		// A boot failure rather than a 500 on the first login: the operator finds
		// out while they are still looking at the deploy.
		it('fails at boot when the ref resolves to nothing, naming it', async () => {
			const empty = new AccessTokenService(env, clock, new MemorySecretStore());

			await expect(empty.onModuleInit()).rejects.toThrow(REF);
		});

		it('reads the ref the environment names', async () => {
			const elsewhere = { ...env, AUTH_JWT_SECRET_REF: 'somewhere/else' } as Env;
			const service = new AccessTokenService(
				elsewhere,
				clock,
				new MemorySecretStore({ 'somewhere/else': SECRET }),
			);

			expect(await service.verify(await service.issue(CLAIMS))).toEqual(CLAIMS);
		});
	});
});
