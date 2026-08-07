import '../../e2e.setup.js';

import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, users } from '@vpn-poc/database';

import { TransactionRunner, type Executor } from './transaction-runner.js';

const DATABASE_URL =
	process.env['DATABASE_URL'] ?? 'postgres://vpn_app:vpn_app_dev@127.0.0.1:25432/poc_vpn_dev';

const { db, sql: raw } = createDatabase({ url: DATABASE_URL, maxConnections: 2 });
const runner = new TransactionRunner(db);

const A = '33333333-3333-3333-3333-333333333333';
const B = '44444444-4444-4444-4444-444444444444';

function userIdFor(accountId: string): string {
	return accountId.replace(/^./, 'a');
}

async function currentScope(executor: Executor) {
	const rows = await executor.execute<{ role: string; account: string; transaction: string }>(sql`
		select
			current_user as role,
			current_setting('app.account_id', true) as account,
			txid_current()::text as transaction
	`);

	return [...rows][0];
}

function scopeOfWork(_discovered: unknown, executor: Executor) {
	return currentScope(executor);
}

function discoverUserOf(accountId: string) {
	return async (executor: Executor) => {
		const rows = await executor
			.select({ accountId: users.accountId })
			.from(users)
			.where(eq(users.id, userIdFor(accountId)));

		return rows[0];
	};
}

beforeAll(async () => {
	await raw.begin(async (tx) => {
		await tx`set local role app_system`;
		await tx`delete from accounts where id in (${A}, ${B})`;

		for (const { id, slug } of [
			{ id: A, slug: 'discovery-a' },
			{ id: B, slug: 'discovery-b' },
		]) {
			await tx`insert into accounts (id, slug, name) values (${id}, ${slug}, ${slug})`;
			await tx`
				insert into users (id, account_id, email, password_hash, role)
				values (${userIdFor(id)}, ${id}, ${`owner@${slug}.example.com`}, 'x', 'owner')
			`;
		}
	});
});

afterAll(async () => {
	await raw.begin(async (tx) => {
		await tx`set local role app_system`;
		await tx`delete from accounts where id in (${A}, ${B})`;
	});
	await raw.end({ timeout: 5 });
});

describe('a discovery transaction', () => {
	it('runs the lookup as app_system, which is the query with no account to scope to', async () => {
		const observed = await runner.runInDiscoveredAccount(async (executor) => {
			expect((await currentScope(executor))?.role).toBe('app_system');
			return discoverUserOf(B)(executor);
		}, scopeOfWork);

		expect(observed?.role).toBe('vpn_app');
	});

	it('scopes the work to the account the lookup found', async () => {
		const observed = await runner.runInDiscoveredAccount(discoverUserOf(B), scopeOfWork);

		expect(observed?.account).toBe(B);
	});

	it('keeps both phases in one transaction, because rotation cannot be split in half', async () => {
		let discovery: string | undefined;

		const observed = await runner.runInDiscoveredAccount(async (executor) => {
			discovery = (await currentScope(executor))?.transaction;
			return discoverUserOf(B)(executor);
		}, scopeOfWork);

		expect(observed?.transaction).toBe(discovery);
	});

	it('reads the discovered account in the work phase', async () => {
		const found = await runner.runInDiscoveredAccount(discoverUserOf(B), (_, executor) =>
			executor
				.select({ id: users.id })
				.from(users)
				.where(eq(users.id, userIdFor(B))),
		);

		expect(found).toHaveLength(1);
	});

	it('reads nothing from the account it did not discover', async () => {
		const found = await runner.runInDiscoveredAccount(discoverUserOf(B), (_, executor) =>
			executor
				.select({ id: users.id })
				.from(users)
				.where(eq(users.id, userIdFor(A))),
		);

		expect(found).toHaveLength(0);
	});

	it('sees both accounts while it is still discovering', async () => {
		const found = await runner.runInDiscoveredAccount(
			async (executor) => {
				const rows = await executor.select({ id: users.id }).from(users);
				return { accountId: B, ids: rows.map((row) => row.id) };
			},
			(discovered) => Promise.resolve(discovered.ids),
		);

		expect(found).toEqual(expect.arrayContaining([userIdFor(A), userIdFor(B)]));
	});
});
