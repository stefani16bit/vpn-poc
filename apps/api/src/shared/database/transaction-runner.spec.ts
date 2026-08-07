import { describe, expect, it } from 'vitest';

import { runInScope } from './db-scope.js';
import { TransactionRunner, type Executor } from './transaction-runner.js';

const EXECUTOR = Symbol('executor') as unknown as Executor;

describe('TransactionRunner', () => {
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
