import { AsyncLocalStorage } from 'node:async_hooks';

import type { Executor } from './transaction-runner.js';

const storage = new AsyncLocalStorage<Executor>();

export function runInScope<T>(executor: Executor, fn: () => Promise<T>): Promise<T> {
	return storage.run(executor, fn);
}

export function currentExecutor(): Executor {
	const executor = storage.getStore();

	if (!executor) {
		throw new Error(
			'no database scope: every query runs inside a transaction the kernel opened, ' +
				'because that transaction is what carries app.account_id',
		);
	}

	return executor;
}

export function hasScope(): boolean {
	return storage.getStore() !== undefined;
}
