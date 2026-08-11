import { describe, expect, it, vi } from 'vitest';

import { FixedClock } from '@vpn/testing/fakes';

import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { SessionRepository } from '../../../shared/identity/repositories/session.repository.js';
import type {
	AccountMember,
	StoredUser,
	UserRepository,
} from '../../../shared/identity/repositories/user.repository.js';
import type { UserRole } from '../../../shared/identity/user.js';
import { UsersService } from './users.service.js';

const ACCOUNT = 'account-1';
const ADMIN = 'user-admin';
const OWNER = 'user-owner';
const MEMBER = 'user-member';
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

function member(id: string, role: UserRole, liveDeviceCount = 0): AccountMember {
	return {
		id,
		email: `${id}@example.com`,
		role,
		emailVerifiedAt: CREATED_AT,
		locale: 'pt-BR',
		createdAt: CREATED_AT,
		liveDeviceCount,
	};
}

function claims(overrides: Partial<AccessTokenClaims> = {}): AccessTokenClaims {
	return {
		userId: ADMIN,
		accountId: ACCOUNT,
		role: 'admin',
		sessionId: 'session-1',
		emailVerified: true,
		...overrides,
	};
}

function service({
	roster = [member(OWNER, 'owner'), member(ADMIN, 'admin'), member(MEMBER, 'member')],
	insert,
	remove,
}: {
	roster?: readonly AccountMember[];
	insert?: () => Promise<StoredUser | undefined>;
	remove?: () => Promise<boolean>;
} = {}) {
	const users = {
		listByAccount: vi.fn(() => Promise.resolve(roster)),
		insertMember: vi.fn(
			insert ??
				((values: { accountId: string; email: string; role: UserRole; locale: string }) =>
					Promise.resolve({
						id: 'user-new',
						accountId: values.accountId,
						email: values.email,
						passwordHash: 'hashed',
						role: values.role,
						emailVerifiedAt: CREATED_AT,
						locale: values.locale,
						createdAt: CREATED_AT,
					} as StoredUser)),
		),
		updateRole: vi.fn(() => Promise.resolve(true)),
		deleteById: vi.fn(remove ?? (() => Promise.resolve(true))),
	};
	const sessions = { revokeAllForUser: vi.fn(() => Promise.resolve()) };
	const hasher = {
		hash: vi.fn((plaintext: string) => Promise.resolve(`hashed:${plaintext}`)),
		verify: vi.fn(() => Promise.resolve(true)),
		needsRehash: vi.fn(() => false),
	};

	return {
		users,
		sessions,
		hasher,
		service: new UsersService(
			users as unknown as UserRepository,
			sessions as unknown as SessionRepository,
			hasher,
			new FixedClock(CREATED_AT),
		),
	};
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

describe('UsersService.list', () => {
	it('shows the owner too, because hiding someone who has access makes the screen lie', async () => {
		const { service: users } = service();

		const { users: listed } = await users.list(claims());

		expect(listed.map((user) => user.role)).toEqual(['owner', 'admin', 'member']);
	});

	it('reports the live device count, which is what explains a refused removal', async () => {
		const { service: users } = service({ roster: [member(MEMBER, 'member', 2)] });

		const { users: listed } = await users.list(claims());

		expect(listed[0]?.liveDeviceCount).toBe(2);
	});
});

describe('UsersService.create', () => {
	it('returns a temporary password and never the hash of it', async () => {
		const { service: users, hasher } = service();

		const created = await users.create(claims(), { email: 'ada@example.com', role: 'member' });

		expect(created.temporaryPassword).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(hasher.hash).toHaveBeenCalledWith(created.temporaryPassword);
		expect(JSON.stringify(created)).not.toContain('hashed:');
	});

	it('generates a different password every time', async () => {
		const { service: users } = service();

		const first = await users.create(claims(), { email: 'a@example.com', role: 'member' });
		const second = await users.create(claims(), { email: 'b@example.com', role: 'member' });

		expect(first.temporaryPassword).not.toBe(second.temporaryPassword);
	});

	it('stamps the address as verified, because the admin vouched and no token exists', async () => {
		const { service: users, users: repository } = service();

		await users.create(claims(), { email: 'ada@example.com', role: 'admin' });

		expect(repository.insertMember).toHaveBeenCalledWith(
			expect.objectContaining({ emailVerifiedAt: CREATED_AT, role: 'admin' }),
		);
	});

	it('answers 409 when the index refuses the address, rather than reading first', async () => {
		const { service: users } = service({ insert: () => Promise.resolve(undefined) });

		expect(
			await codeOf(users.create(claims(), { email: 'taken@example.com', role: 'member' })),
		).toBe('CONFLICT');
	});

	it('turns the named unique violation into the same 409', async () => {
		const { service: users } = service({
			insert: () =>
				Promise.reject({ code: '23505', constraint_name: 'users_account_email_key' }) as never,
		});

		expect(
			await codeOf(users.create(claims(), { email: 'taken@example.com', role: 'member' })),
		).toBe('CONFLICT');
	});

	it('does not turn an unrelated failure into a conflict', async () => {
		const { service: users } = service({
			insert: () => Promise.reject(new Error('connection lost')) as never,
		});

		await expect(
			users.create(claims(), { email: 'ada@example.com', role: 'member' }),
		).rejects.toThrow('connection lost');
	});
});

describe('UsersService.changeRole', () => {
	it('kills the sessions, because role rides inside a token nobody revokes', async () => {
		const { service: users, sessions } = service();

		await users.changeRole(claims(), MEMBER, 'admin');

		expect(sessions.revokeAllForUser).toHaveBeenCalledWith(MEMBER, CREATED_AT);
	});

	it('refuses to let an admin change their own role, or an account reaches zero admins', async () => {
		const { service: users, users: repository } = service();

		expect(await codeOf(users.changeRole(claims(), ADMIN, 'member'))).toBe('FORBIDDEN');
		expect(repository.updateRole).not.toHaveBeenCalled();
	});

	it('refuses to touch the owner, which is one per account by index', async () => {
		const { service: users } = service();

		expect(await codeOf(users.changeRole(claims(), OWNER, 'admin'))).toBe('FORBIDDEN');
	});

	it('answers 404 for a user of another account, so nothing confirms it exists', async () => {
		const { service: users } = service({ roster: [member(ADMIN, 'admin')] });

		expect(await codeOf(users.changeRole(claims(), 'user-elsewhere', 'member'))).toBe('NOT_FOUND');
	});
});

describe('UsersService.remove', () => {
	it('revokes the sessions and deletes the row', async () => {
		const { service: users, sessions, users: repository } = service();

		await users.remove(claims(), MEMBER);

		expect(sessions.revokeAllForUser).toHaveBeenCalledWith(MEMBER, CREATED_AT);
		expect(repository.deleteById).toHaveBeenCalledWith(MEMBER);
	});

	it('answers 409 when the database refuses because a device is still live', async () => {
		const { service: users } = service({
			remove: () => Promise.reject({ code: '23001' }) as never,
		});

		expect(await codeOf(users.remove(claims(), MEMBER))).toBe('CONFLICT');
	});

	it('does not swallow an unrelated database failure', async () => {
		const { service: users } = service({
			remove: () => Promise.reject(new Error('connection lost')) as never,
		});

		await expect(users.remove(claims(), MEMBER)).rejects.toThrow('connection lost');
	});

	it('refuses self-removal and owner removal for the same reasons as a role change', async () => {
		const { service: users } = service();

		expect(await codeOf(users.remove(claims(), ADMIN))).toBe('FORBIDDEN');
		expect(await codeOf(users.remove(claims(), OWNER))).toBe('FORBIDDEN');
	});
});
