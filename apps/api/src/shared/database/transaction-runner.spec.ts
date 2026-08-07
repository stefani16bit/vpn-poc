import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import { runInScope } from './db-scope.js';
import { TransactionRunner, type Executor } from './transaction-runner.js';

const EXECUTOR = Symbol('executor') as unknown as Executor;

function fakeRunner() {
	const dialect = new PgDialect();
	const executed: { sql: string; params: unknown[] }[] = [];

	const tx = {
		execute: (query: SQL) => {
			const { sql, params } = dialect.sqlToQuery(query);
			executed.push({ sql, params });
			return Promise.resolve(undefined);
		},
	};

	const db = { transaction: (work: (tx: unknown) => Promise<unknown>) => work(tx) };

	return { runner: new TransactionRunner(db as never), executed, tx: tx as unknown as Executor };
}

describe('TransactionRunner', () => {
	it('fixes the account on the request transaction, so the policy has a value to read', async () => {
		const { runner, executed, tx } = fakeRunner();
		const work = vi.fn(async () => 'done');

		expect(await runner.runInAccount('acc-1', work)).toBe('done');
		expect(executed).toEqual([
			{ sql: "select set_config('app.account_id', $1, true)", params: ['acc-1'] },
		]);
		expect(work).toHaveBeenCalledWith(tx);
	});

	it('assumes the system role on a system transaction, since there is no account to fix', async () => {
		const { runner, executed, tx } = fakeRunner();
		const work = vi.fn(async () => 'done');

		expect(await runner.runAsSystem(work)).toBe('done');
		expect(executed).toEqual([{ sql: 'set local role app_system', params: [] }]);
		expect(work).toHaveBeenCalledWith(tx);
	});

	it('refuses to assume app_system inside a transaction that is already open', async () => {
		const runner = new TransactionRunner({} as never);

		await runInScope(EXECUTOR, async () => {
			expect(() => runner.runAsSystem(async () => undefined)).toThrow(/app_system/);
		});
	});

	it('says why, because the failure it prevents is invisible', async () => {
		const runner = new TransactionRunner({} as never);

		await runInScope(EXECUTOR, async () => {
			expect(() => runner.runAsSystem(async () => undefined)).toThrow(/survives the savepoint/);
		});
	});
});

describe('TransactionRunner.runInDiscoveredAccount', () => {
	it('drops the system role and scopes to the account before the work starts', async () => {
		const { runner, executed } = fakeRunner();
		let seen: string[] = [];

		await runner.runInDiscoveredAccount(
			async () => ({ accountId: 'acc-1' }),
			async () => {
				seen = executed.map((statement) => statement.sql);
			},
		);

		expect(seen).toEqual([
			'set local role app_system',
			'reset role',
			"select set_config('app.account_id', $1, true)",
		]);
	});

	it('scopes to the account the discovery found, not one the caller passed', async () => {
		const { runner, executed } = fakeRunner();

		await runner.runInDiscoveredAccount(
			async () => ({ accountId: 'acc-discovered' }),
			async () => undefined,
		);

		expect(executed.at(-1)?.params).toEqual(['acc-discovered']);
	});

	it('hands the discovery and the transaction to the work', async () => {
		const { runner, tx } = fakeRunner();
		const work = vi.fn(async () => 'done');

		const result = await runner.runInDiscoveredAccount(
			async () => ({ accountId: 'acc-1', familyId: 'fam-1' }),
			work,
		);

		expect(result).toBe('done');
		expect(work).toHaveBeenCalledWith({ accountId: 'acc-1', familyId: 'fam-1' }, tx);
	});

	it('runs the discovery as app_system, since that is the query with no account to scope to', async () => {
		const { runner, executed } = fakeRunner();

		await runner.runInDiscoveredAccount(
			async () => {
				expect(executed.map((statement) => statement.sql)).toEqual(['set local role app_system']);
				return { accountId: 'acc-1' };
			},
			async () => undefined,
		);
	});

	it('never runs the work when the discovery finds no account', async () => {
		const { runner, executed } = fakeRunner();
		const work = vi.fn(async () => 'done');

		const result = await runner.runInDiscoveredAccount(async () => undefined, work);

		expect(result).toBeUndefined();
		expect(work).not.toHaveBeenCalled();
		expect(executed.map((statement) => statement.sql)).toEqual(['set local role app_system']);
	});

	it('refuses to assume app_system inside a transaction that is already open', async () => {
		const runner = new TransactionRunner({} as never);

		await runInScope(EXECUTOR, async () => {
			expect(() =>
				runner.runInDiscoveredAccount(
					async () => ({ accountId: 'acc-1' }),
					async () => undefined,
				),
			).toThrow(/survives the savepoint/);
		});
	});
});
