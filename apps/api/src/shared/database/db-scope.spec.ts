import { describe, expect, it } from 'vitest';

import { currentExecutor, hasScope, runInScope } from './db-scope.js';
import type { Executor } from './transaction-runner.js';

const EXECUTOR = Symbol('executor') as unknown as Executor;

describe('db scope', () => {
	it('hands back the executor the kernel opened', async () => {
		await runInScope(EXECUTOR, async () => {
			expect(currentExecutor()).toBe(EXECUTOR);
		});
	});

	it('throws outside a scope rather than falling back to the pool', () => {
		expect(() => currentExecutor()).toThrow(/no database scope/);
	});

	it('reports whether a scope is open, so the interceptor does not nest one', async () => {
		expect(hasScope()).toBe(false);
		await runInScope(EXECUTOR, async () => {
			expect(hasScope()).toBe(true);
		});
		expect(hasScope()).toBe(false);
	});

	it('survives an await, which is the whole reason it is async local', async () => {
		await runInScope(EXECUTOR, async () => {
			await Promise.resolve();
			expect(currentExecutor()).toBe(EXECUTOR);
		});
	});

	it('does not leak out of a scope that threw', async () => {
		await expect(
			runInScope(EXECUTOR, async () => {
				throw new Error('boom');
			}),
		).rejects.toThrow('boom');

		expect(hasScope()).toBe(false);
	});

	it('keeps two concurrent scopes apart', async () => {
		const other = Symbol('other') as unknown as Executor;

		await Promise.all([
			runInScope(EXECUTOR, async () => {
				await Promise.resolve();
				expect(currentExecutor()).toBe(EXECUTOR);
			}),
			runInScope(other, async () => {
				await Promise.resolve();
				expect(currentExecutor()).toBe(other);
			}),
		]);
	});
});
