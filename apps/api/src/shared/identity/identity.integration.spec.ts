import '../../e2e.setup.js';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '@vpn-poc/database';

import { TransactionRunner } from '../database/transaction-runner.js';
import { VerificationTokenRepository } from '../verification/verification-token.repository.js';
import { AccountRepository } from './repositories/account.repository.js';
import { SessionRepository } from './repositories/session.repository.js';
import { UserRepository } from './repositories/user.repository.js';
import { decideRotation } from './session-rotation.js';

const DATABASE_URL =
	process.env['DATABASE_URL'] ?? 'postgres://vpn_app:vpn_app_dev@127.0.0.1:25432/poc_vpn_dev';

const { db, sql } = createDatabase({ url: DATABASE_URL, maxConnections: 4 });

const transactions = new TransactionRunner(db);
const accountRepository = new AccountRepository(db);
const users = new UserRepository(db);
const sessions = new SessionRepository(db);
const verificationTokens = new VerificationTokenRepository(db);

const A = '33333333-3333-3333-3333-333333333333';
const B = '44444444-4444-4444-4444-444444444444';
const C = '55555555-5555-5555-5555-555555555555';
const OWNER_A = 'a3333333-3333-3333-3333-333333333333';
const OWNER_B = 'a4444444-4444-4444-4444-444444444444';
const MEMBER_B = 'b4444444-4444-4444-4444-444444444444';
const FAMILY_A = 'f3333333-3333-3333-3333-333333333333';

const REFRESH_HASH = 'identity-refresh-hash';
const VERIFICATION_HASH = 'identity-verification-hash';
const SHARED_EMAIL = 'shared@identity.example.com';
const CLAIMED_SLUG = 'identity-claim';

const NOW = new Date('2026-08-07T12:00:00.000Z');
const LATER = new Date('2026-08-07T13:00:00.000Z');
const EXPIRES_AT = new Date('2026-09-01T00:00:00.000Z');

type Row = Record<string, unknown>;
type SystemSql = typeof sql;

function asSystem<T>(work: (tx: SystemSql) => Promise<T>): Promise<T> {
	return sql.begin(async (tx) => {
		await tx`set local role app_system`;
		return work(tx as unknown as SystemSql);
	}) as Promise<T>;
}

function rowsAsSystem(statement: (tx: SystemSql) => Promise<unknown>): Promise<Row[]> {
	// postgres.js hands back a RowList, which does not narrow to Row[] on its own.
	return asSystem(statement) as Promise<Row[]>;
}

async function wipe(): Promise<void> {
	await asSystem(async (tx) => {
		await tx`delete from accounts where id in (${A}, ${B}, ${C})`;
		await tx`delete from accounts where slug like ${`${CLAIMED_SLUG}%`}`;
	});
}

beforeEach(async () => {
	await wipe();

	await asSystem(async (tx) => {
		for (const { id, slug } of [
			{ id: A, slug: 'identity-a' },
			{ id: B, slug: 'identity-b' },
			{ id: C, slug: 'identity-c' },
		]) {
			await tx`insert into accounts (id, slug, name) values (${id}, ${slug}, ${slug})`;
		}

		await tx`
			insert into users (id, account_id, email, password_hash, role)
			values (${OWNER_A}, ${A}, ${SHARED_EMAIL}, 'x', 'owner')
		`;
		await tx`
			insert into users (id, account_id, email, password_hash, role)
			values (${OWNER_B}, ${B}, 'owner-b@identity.example.com', 'x', 'owner')
		`;
		await tx`
			insert into users (id, account_id, email, password_hash, role)
			values (${MEMBER_B}, ${B}, ${SHARED_EMAIL}, 'x', 'member')
		`;
		await tx`
			insert into session_families (id, account_id, user_id)
			values (${FAMILY_A}, ${A}, ${OWNER_A})
		`;
		await tx`
			insert into refresh_tokens (token_hash, account_id, family_id, expires_at)
			values (${REFRESH_HASH}, ${A}, ${FAMILY_A}, ${EXPIRES_AT.toISOString()}::timestamptz)
		`;
		await tx`
			insert into verification_tokens (token_hash, account_id, user_id, purpose, expires_at)
			values (
				${VERIFICATION_HASH}, ${A}, ${OWNER_A}, 'email_verification',
				${EXPIRES_AT.toISOString()}::timestamptz
			)
		`;
	});
});

afterAll(async () => {
	await wipe();
	await sql.end({ timeout: 5 });
});

function spend(at: Date): Promise<boolean> {
	return transactions.runInAccount(A, (tx) => sessions.spendToken(REFRESH_HASH, at, tx));
}

function asDate(value: unknown): Date | null {
	return value === null || value === undefined ? null : new Date(String(value));
}

async function spentAt(): Promise<Date | null> {
	const [row] = await rowsAsSystem(
		(tx) => tx`select spent_at from refresh_tokens where token_hash = ${REFRESH_HASH}`,
	);
	return asDate(row?.['spent_at']);
}

describe('spending a refresh token', () => {
	it('lets exactly one of two concurrent transactions spend the same hash', async () => {
		const outcomes = await Promise.all([spend(NOW), spend(NOW)]);

		expect(outcomes.filter(Boolean)).toHaveLength(1);
	});

	it('refuses a hash already spent and leaves the first timestamp standing', async () => {
		expect(await spend(NOW)).toBe(true);
		expect(await spend(LATER)).toBe(false);
		expect(await spentAt()).toEqual(NOW);
	});
});

describe('rotating a refresh token', () => {
	function rotate(): Promise<string> {
		return transactions.runInAccount(A, async (tx) => {
			const candidate = await sessions.lockByTokenHash(REFRESH_HASH, tx);
			if (!candidate) return 'missing';

			const decision = decideRotation(candidate, NOW);
			if (decision.kind !== 'rotate') return decision.kind;

			return (await sessions.spendToken(REFRESH_HASH, NOW, tx)) ? 'rotate' : 'lost the update';
		});
	}

	it('makes the loser of two concurrent rotations read the spend, not decide on a stale row', async () => {
		const outcomes = await Promise.all([rotate(), rotate()]);

		expect(outcomes.sort()).toEqual(['revoke_family', 'rotate']);
	});
});

describe('consuming a verification token', () => {
	function consume(at: Date) {
		return transactions.runInAccount(A, (tx) =>
			verificationTokens.consume(VERIFICATION_HASH, 'email_verification', at, tx),
		);
	}

	it('lets exactly one of two concurrent transactions consume the same hash', async () => {
		const outcomes = await Promise.all([consume(NOW), consume(NOW)]);

		expect(outcomes.filter(Boolean)).toHaveLength(1);
	});

	it('returns nothing for a hash whose purpose does not match', async () => {
		const consumed = await transactions.runInAccount(A, (tx) =>
			verificationTokens.consume(VERIFICATION_HASH, 'password_reset', NOW, tx),
		);

		expect(consumed).toBeUndefined();
	});

	it('leaves one outstanding token when issuing invalidates what came before', async () => {
		await transactions.runInAccount(A, async (tx) => {
			await verificationTokens.invalidateOutstanding(OWNER_A, 'email_verification', NOW, tx);
			await verificationTokens.issue(
				{
					userId: OWNER_A,
					accountId: A,
					purpose: 'email_verification',
					tokenHash: 'identity-verification-hash-2',
					expiresAt: EXPIRES_AT,
				},
				tx,
			);
		});

		const outstanding = await rowsAsSystem(
			(tx) => tx`
				select token_hash from verification_tokens
				where user_id = ${OWNER_A} and consumed_at is null
			`,
		);

		expect(outstanding.map((row) => row['token_hash'])).toEqual(['identity-verification-hash-2']);
	});
});

describe('marking an e-mail verified', () => {
	async function verifiedAt(): Promise<Date | null> {
		const [row] = await rowsAsSystem(
			(tx) => tx`select email_verified_at from users where id = ${OWNER_A}`,
		);
		return asDate(row?.['email_verified_at']);
	}

	it('does not move the timestamp when it happens twice', async () => {
		await transactions.runInAccount(A, (tx) => users.markEmailVerified(OWNER_A, NOW, tx));
		await transactions.runInAccount(A, (tx) => users.markEmailVerified(OWNER_A, LATER, tx));

		expect(await verifiedAt()).toEqual(NOW);
	});
});

describe('looking a user up by e-mail', () => {
	it('finds nothing when the address exists in more than one account', async () => {
		const found = await transactions.runAsSystem((tx) => users.findByEmail(SHARED_EMAIL, tx));

		expect(found).toBeUndefined();
	});

	it('finds the one row the policy leaves visible inside an account', async () => {
		const found = await transactions.runInAccount(A, (tx) => users.findByEmail(SHARED_EMAIL, tx));

		expect(found?.id).toBe(OWNER_A);
	});
});

describe('inserting a user', () => {
	it('reports the address as taken instead of raising, which is what makes a double submit safe', async () => {
		const inserted = await transactions.runAsSystem((tx) =>
			users.insert(
				{ accountId: B, email: SHARED_EMAIL, passwordHash: 'x', role: 'member', locale: 'pt-BR' },
				tx,
			),
		);

		expect(inserted).toBeUndefined();
	});

	it('refuses to let one address found a second account', async () => {
		const inserted = await transactions.runAsSystem((tx) =>
			users.insert(
				{ accountId: C, email: SHARED_EMAIL, passwordHash: 'x', role: 'owner', locale: 'pt-BR' },
				tx,
			),
		);

		expect(inserted).toBeUndefined();
	});

	it('refuses a second owner in the same account', async () => {
		await expect(
			asSystem(
				(tx) => tx`
					insert into users (account_id, email, password_hash, role)
					values (${A}, 'second-owner@identity.example.com', 'x', 'owner')
				`,
			),
		).rejects.toMatchObject({ code: '23505' });
	});
});

describe('claiming a slug', () => {
	it('lets exactly one of two concurrent claims of the same slug through', async () => {
		const claim = () =>
			transactions.runAsSystem((tx) =>
				accountRepository.claimSlug({ slug: CLAIMED_SLUG, name: CLAIMED_SLUG }, tx),
			);

		const outcomes = await Promise.all([claim(), claim()]);

		expect(outcomes.filter(Boolean)).toHaveLength(1);
	});
});
