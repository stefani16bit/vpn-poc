import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '@vpn-poc/env';
import { FixedClock } from '@vpn/testing/fakes';
import type { IPasswordHasher } from '@vpn/ports';

import { IdentityService } from './identity.service.js';
import type { AccountRepository } from './repositories/account.repository.js';
import type { StoredUser, UserRepository } from './repositories/user.repository.js';
import type { SessionRepository } from './repositories/session.repository.js';

type Mock = ReturnType<typeof vi.fn>;

const NOW = new Date('2026-08-07T12:00:00.000Z');
const EXECUTOR = Symbol('executor');
const env = { AUTH_REFRESH_TOKEN_TTL: 2_592_000 } as Env;

function storedUser(overrides: Partial<StoredUser> = {}): StoredUser {
	return {
		id: 'user-1',
		accountId: 'account-1',
		role: 'owner',
		email: 'ada@example.com',
		passwordHash: 'hash-1',
		emailVerifiedAt: null,
		locale: 'pt-BR',
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	};
}

describe('IdentityService', () => {
	let accounts: Record<string, Mock>;
	let users: Record<string, Mock>;
	let sessions: Record<string, Mock>;
	let hasher: Record<string, Mock>;
	let clock: FixedClock;
	let service: IdentityService;

	beforeEach(() => {
		accounts = {
			claimSlug: vi
				.fn()
				.mockResolvedValue({ id: 'account-1', slug: 'ada', name: 'ada', createdAt: NOW }),
			findBySlug: vi.fn().mockResolvedValue(undefined),
			findById: vi.fn().mockResolvedValue(undefined),
		};
		users = {
			insert: vi.fn().mockResolvedValue(storedUser()),
			findByEmail: vi.fn().mockResolvedValue(storedUser()),
			findById: vi.fn().mockResolvedValue(storedUser()),
			updatePasswordHash: vi.fn().mockResolvedValue(undefined),
			setLocale: vi.fn().mockResolvedValue(undefined),
			markEmailVerified: vi.fn().mockResolvedValue(undefined),
		};
		sessions = {
			createFamily: vi.fn().mockResolvedValue('family-1'),
			insertToken: vi.fn().mockResolvedValue(undefined),
			lockByTokenHash: vi.fn(),
			spendToken: vi.fn().mockResolvedValue(true),
			familyIdByTokenHash: vi.fn().mockResolvedValue('family-1'),
			revokeFamily: vi.fn().mockResolvedValue(undefined),
			revokeAllForUser: vi.fn().mockResolvedValue(undefined),
		};
		hasher = {
			hash: vi.fn().mockResolvedValue('hash-new'),
			verify: vi.fn().mockResolvedValue(true),
			needsRehash: vi.fn().mockReturnValue(false),
		};
		clock = new FixedClock(NOW);

		service = new IdentityService(
			env,
			clock,
			hasher as unknown as IPasswordHasher,
			accounts as unknown as AccountRepository,
			users as unknown as UserRepository,
			sessions as unknown as SessionRepository,
		);
	});

	describe('register', () => {
		it('reports the created user', async () => {
			await expect(service.register('ada@example.com', 'pw', 'pt-BR')).resolves.toEqual({
				kind: 'registered',
				user: expect.objectContaining({ id: 'user-1', email: 'ada@example.com' }),
			});
		});

		it('never hands the password hash back to the caller', async () => {
			const outcome = await service.register('ada@example.com', 'pw', 'pt-BR');
			if (outcome.kind !== 'registered') throw new Error('expected a registration');
			expect(outcome.user).not.toHaveProperty('passwordHash');
		});

		it('reports a duplicate address rather than throwing', async () => {
			users['insert']?.mockResolvedValue(undefined);
			await expect(service.register('ada@example.com', 'pw', 'pt-BR')).resolves.toEqual({
				kind: 'email_taken',
			});
		});

		it('normalizes the address, so case and padding cannot create a twin', async () => {
			await service.register('  ADA@Example.COM ', 'pw', 'pt-BR');
			expect(users['insert']?.mock.calls[0]?.[0]).toMatchObject({ email: 'ada@example.com' });
		});

		it('stores the hash, never the password', async () => {
			await service.register('ada@example.com', 'pw', 'pt-BR');
			expect(users['insert']?.mock.calls[0]?.[0]).toMatchObject({ passwordHash: 'hash-new' });
		});

		it('joins a caller transaction when given one', async () => {
			await service.register('ada@example.com', 'pw', 'pt-BR', EXECUTOR as never);
			expect(users['insert']?.mock.calls[0]?.[1]).toBe(EXECUTOR);
		});

		it('creates the account and makes the registrant its owner', async () => {
			await service.register('ada@example.com', 'pw', 'pt-BR');

			expect(accounts['claimSlug']).toHaveBeenCalledWith({ slug: 'ada', name: 'ada' }, undefined);
			expect(users['insert']?.mock.calls[0]?.[0]).toMatchObject({
				accountId: 'account-1',
				role: 'owner',
			});
		});

		it('derives the slug from the address, not from anything the caller supplies', async () => {
			await service.register('Ada.Lovelace@example.com', 'pw', 'pt-BR');
			expect(accounts['claimSlug']?.mock.calls[0]?.[0]).toMatchObject({ slug: 'ada-lovelace' });
		});

		it('walks to the next candidate when the slug is taken', async () => {
			accounts['claimSlug']
				?.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce({ id: 'account-2', slug: 'ada-2', name: 'ada', createdAt: NOW });

			await service.register('ada@example.com', 'pw', 'pt-BR');

			expect(accounts['claimSlug']?.mock.calls[0]?.[0]).toMatchObject({ slug: 'ada' });
			expect(accounts['claimSlug']?.mock.calls[1]?.[0]).toMatchObject({ slug: 'ada-2' });
		});

		it('never asks whether a slug is free before trying to take it', async () => {
			await service.register('ada@example.com', 'pw', 'pt-BR');
			expect(accounts['findBySlug']).not.toHaveBeenCalled();
		});

		it('gives up loudly rather than looping forever on slug contention', async () => {
			accounts['claimSlug']?.mockResolvedValue(undefined);
			await expect(service.register('ada@example.com', 'pw', 'pt-BR')).rejects.toThrow(
				/slug candidates/,
			);
		});
	});

	describe('authenticate', () => {
		it('returns the user for the right password', async () => {
			await expect(service.authenticate('ada@example.com', 'pw')).resolves.toMatchObject({
				id: 'user-1',
			});
		});

		it('returns null for a wrong password', async () => {
			hasher['verify']?.mockResolvedValue(false);
			await expect(service.authenticate('ada@example.com', 'pw')).resolves.toBeNull();
		});

		it('returns null when the address is unknown', async () => {
			users['findByEmail']?.mockResolvedValue(undefined);
			await expect(service.authenticate('nobody@example.com', 'pw')).resolves.toBeNull();
		});

		it('still runs a verification when the address is unknown, so timing does not enumerate', async () => {
			users['findByEmail']?.mockResolvedValue(undefined);
			await service.authenticate('nobody@example.com', 'pw');
			expect(hasher['verify']).toHaveBeenCalledTimes(1);
		});

		it('upgrades a hash that is below the current parameters', async () => {
			hasher['needsRehash']?.mockReturnValue(true);
			await service.authenticate('ada@example.com', 'pw');
			expect(users['updatePasswordHash']).toHaveBeenCalledWith('user-1', 'hash-new', NOW);
		});

		it('leaves a current hash alone', async () => {
			await service.authenticate('ada@example.com', 'pw');
			expect(users['updatePasswordHash']).not.toHaveBeenCalled();
		});

		it('scopes the lookup to the account when a slug is given', async () => {
			accounts['findBySlug']?.mockResolvedValue({ id: 'account-9', slug: 'acme', name: 'acme' });
			users['findByAccountAndEmail'] = vi.fn().mockResolvedValue(storedUser());

			await service.authenticate('ada@example.com', 'pw', 'acme');

			expect(users['findByAccountAndEmail']).toHaveBeenCalledWith('account-9', 'ada@example.com');
			expect(users['findByEmail']).not.toHaveBeenCalled();
		});

		it('treats an unknown slug as bad credentials, never as not-found', async () => {
			accounts['findBySlug']?.mockResolvedValue(undefined);

			await expect(service.authenticate('ada@example.com', 'pw', 'nope')).resolves.toBeNull();
			expect(hasher['verify']).toHaveBeenCalledWith('pw', expect.stringContaining('scrypt$'));
		});

		it('runs exactly one verification when the address is ambiguous', async () => {
			users['findByEmail']?.mockResolvedValue(undefined);

			await service.authenticate('ada@example.com', 'pw');

			expect(hasher['verify']).toHaveBeenCalledTimes(1);
		});
	});

	describe('lookups', () => {
		it('normalizes the address before looking it up', async () => {
			await service.findByEmail('ADA@EXAMPLE.COM');
			expect(users['findByEmail']).toHaveBeenCalledWith('ada@example.com');
		});

		it('returns null rather than undefined for an unknown address', async () => {
			users['findByEmail']?.mockResolvedValue(undefined);
			await expect(service.findByEmail('nobody@example.com')).resolves.toBeNull();
		});

		it('returns null rather than undefined for an unknown id', async () => {
			users['findById']?.mockResolvedValue(undefined);
			await expect(service.findById('missing')).resolves.toBeNull();
		});

		it('finds by id', async () => {
			await expect(service.findById('user-1')).resolves.toMatchObject({ id: 'user-1' });
		});
	});

	describe('startSession', () => {
		it('binds the session to the user and the new family', async () => {
			const session = await service.startSession({ id: 'user-1', accountId: 'account-1' });
			expect(session).toMatchObject({
				userId: 'user-1',
				accountId: 'account-1',
				sessionId: 'family-1',
			});
		});

		it('issues a refresh token long enough to be unguessable', async () => {
			const session = await service.startSession({ id: 'user-1', accountId: 'account-1' });
			expect(session.refreshToken.length).toBeGreaterThanOrEqual(32);
		});

		it('issues a distinct token each time', async () => {
			const first = await service.startSession({ id: 'user-1', accountId: 'account-1' });
			const second = await service.startSession({ id: 'user-1', accountId: 'account-1' });
			expect(first.refreshToken).not.toBe(second.refreshToken);
		});

		it('stores only the hash of the token', async () => {
			const session = await service.startSession({ id: 'user-1', accountId: 'account-1' });
			const stored = sessions['insertToken']?.mock.calls[0]?.[0] as { tokenHash: string };
			expect(stored.tokenHash).not.toBe(session.refreshToken);
			expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
		});

		it('expires the token by the configured ttl', async () => {
			const session = await service.startSession({ id: 'user-1', accountId: 'account-1' });
			expect(session.expiresAt).toEqual(new Date(NOW.getTime() + 2_592_000 * 1000));
		});
	});

	function candidate(overrides = {}) {
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

	describe('lockRotation', () => {
		it('looks the token up by its hash, never by the token itself', async () => {
			sessions['lockByTokenHash']?.mockResolvedValue(candidate());
			await service.lockRotation('token-1', EXECUTOR as never);

			expect(sessions['lockByTokenHash']?.mock.calls[0]?.[0]).toMatch(/^[0-9a-f]{64}$/);
			expect(sessions['lockByTokenHash']?.mock.calls[0]?.[1]).toBe(EXECUTOR);
		});

		it('reports the account of the family, which is all the lookup exists to find', async () => {
			sessions['lockByTokenHash']?.mockResolvedValue(candidate());
			await expect(service.lockRotation('token-1', EXECUTOR as never)).resolves.toMatchObject({
				accountId: 'account-1',
			});
		});

		it('carries the hash forward, so the rotation does not compute it twice', async () => {
			sessions['lockByTokenHash']?.mockResolvedValue(candidate());
			const locked = await service.lockRotation('token-1', EXECUTOR as never);

			expect(locked?.tokenHash).toBe(sessions['lockByTokenHash']?.mock.calls[0]?.[0]);
		});

		it('finds nothing for a token it never issued', async () => {
			sessions['lockByTokenHash']?.mockResolvedValue(undefined);
			await expect(service.lockRotation('nope', EXECUTOR as never)).resolves.toBeUndefined();
		});
	});

	describe('rotateSession', () => {
		async function lock(overrides = {}) {
			sessions['lockByTokenHash']?.mockResolvedValue(candidate(overrides));
			const locked = await service.lockRotation('token-1', EXECUTOR as never);
			if (!locked) throw new Error('expected a locked rotation');

			return locked;
		}

		it('rotates a live token into a new one in the same family', async () => {
			const outcome = await service.rotateSession(await lock(), EXECUTOR as never);

			expect(outcome.kind).toBe('rotated');
			if (outcome.kind !== 'rotated') return;
			expect(outcome.session.sessionId).toBe('family-1');
			expect(outcome.session.refreshToken).not.toBe('token-1');
		});

		it('marks the presented token spent', async () => {
			await service.rotateSession(await lock(), EXECUTOR as never);
			expect(sessions['spendToken']).toHaveBeenCalled();
		});

		it('reports a replayed token as reuse, not a plain rejection', async () => {
			await expect(
				service.rotateSession(await lock({ spentAt: NOW }), EXECUTOR as never),
			).resolves.toEqual({ kind: 'reuse_detected', sessionId: 'family-1' });
		});

		it('revokes the whole family on reuse, not just the token', async () => {
			await service.rotateSession(await lock({ spentAt: NOW }), EXECUTOR as never);
			expect(sessions['revokeFamily']).toHaveBeenCalledWith('family-1', NOW, EXECUTOR);
		});

		it('rejects when the family is already revoked', async () => {
			await expect(
				service.rotateSession(await lock({ revokedAt: NOW }), EXECUTOR as never),
			).resolves.toEqual({ kind: 'rejected' });
		});

		it('rejects an expired token', async () => {
			const expiresAt = new Date(NOW.getTime() - 1);
			await expect(
				service.rotateSession(await lock({ expiresAt }), EXECUTOR as never),
			).resolves.toEqual({ kind: 'rejected' });
		});

		it('rejects when it loses the race to spend the token', async () => {
			const locked = await lock();
			sessions['spendToken']?.mockResolvedValue(false);

			await expect(service.rotateSession(locked, EXECUTOR as never)).resolves.toEqual({
				kind: 'rejected',
			});
		});

		it('does the whole rotation on one executor', async () => {
			await service.rotateSession(await lock(), EXECUTOR as never);

			expect(sessions['spendToken']?.mock.calls[0]?.[2]).toBe(EXECUTOR);
			expect(sessions['insertToken']?.mock.calls[0]?.[1]).toBe(EXECUTOR);
		});
	});

	describe('revocation', () => {
		it('revokes the family the token belongs to', async () => {
			await service.revokeSession('token-1');
			expect(sessions['revokeFamily']).toHaveBeenCalledWith('family-1', NOW);
		});

		it('treats revoking an unknown token as a success', async () => {
			sessions['familyIdByTokenHash']?.mockResolvedValue(undefined);
			await expect(service.revokeSession('never-issued')).resolves.toBeUndefined();
			expect(sessions['revokeFamily']).not.toHaveBeenCalled();
		});

		it('revokes every family for a user', async () => {
			await service.revokeAllSessions('user-1');
			expect(sessions['revokeAllForUser']).toHaveBeenCalledWith('user-1', NOW);
		});
	});

	describe('user state', () => {
		it('marks the e-mail verified at the current time', async () => {
			await service.markEmailVerified('user-1');
			expect(users['markEmailVerified']).toHaveBeenCalledWith('user-1', NOW, undefined);
		});

		it('sets the locale', async () => {
			await service.setLocale('user-1', 'en');
			expect(users['setLocale']).toHaveBeenCalledWith('user-1', 'en', NOW, undefined);
		});

		it('changes the password to a fresh hash', async () => {
			await service.changePassword('user-1', 'new-password');
			expect(users['updatePasswordHash']).toHaveBeenCalledWith(
				'user-1',
				'hash-new',
				NOW,
				undefined,
			);
		});

		it('revokes every session when the password changes', async () => {
			await service.changePassword('user-1', 'new-password');
			expect(sessions['revokeAllForUser']).toHaveBeenCalledWith('user-1', NOW, undefined);
		});
	});
});
