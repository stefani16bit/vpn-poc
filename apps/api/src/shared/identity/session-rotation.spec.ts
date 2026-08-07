import { describe, expect, it } from 'vitest';

import { decideRotation, type RotationCandidate } from './session-rotation.js';

const NOW = new Date('2026-08-07T12:00:00.000Z');

function candidate(overrides: Partial<RotationCandidate> = {}): RotationCandidate {
	return {
		familyId: 'family-1',
		userId: 'user-1',
		accountId: 'account-1',
		spentAt: null,
		expiresAt: new Date(NOW.getTime() + 60_000),
		revokedAt: null,
		...overrides,
	};
}

describe('decideRotation', () => {
	it('rotates a live, unspent token', () => {
		expect(decideRotation(candidate(), NOW)).toEqual({
			kind: 'rotate',
			familyId: 'family-1',
			userId: 'user-1',
			accountId: 'account-1',
		});
	});

	it('rejects a token it never issued', () => {
		expect(decideRotation(undefined, NOW)).toEqual({ kind: 'reject' });
	});

	it('revokes the family when a spent token is replayed', () => {
		expect(decideRotation(candidate({ spentAt: NOW }), NOW)).toEqual({
			kind: 'revoke_family',
			familyId: 'family-1',
		});
	});

	it('rejects rather than revoking when the family is already revoked', () => {
		expect(decideRotation(candidate({ revokedAt: NOW }), NOW)).toEqual({ kind: 'reject' });
	});

	it('treats a revoked family as final even if the token was also replayed', () => {
		expect(decideRotation(candidate({ revokedAt: NOW, spentAt: NOW }), NOW)).toEqual({
			kind: 'reject',
		});
	});

	it('rejects an expired token', () => {
		const expiresAt = new Date(NOW.getTime() - 1);
		expect(decideRotation(candidate({ expiresAt }), NOW)).toEqual({ kind: 'reject' });
	});

	it('treats expiry as inclusive — a token expiring exactly now is dead', () => {
		expect(decideRotation(candidate({ expiresAt: NOW }), NOW)).toEqual({ kind: 'reject' });
	});

	it('reports reuse before expiry, so a replayed dead token still kills the family', () => {
		const expiresAt = new Date(NOW.getTime() - 1);
		expect(decideRotation(candidate({ spentAt: NOW, expiresAt }), NOW)).toEqual({
			kind: 'revoke_family',
			familyId: 'family-1',
		});
	});
});
