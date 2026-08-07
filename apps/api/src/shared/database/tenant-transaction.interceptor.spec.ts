import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runInScope } from './db-scope.js';
import { TenantTransactionInterceptor } from './tenant-transaction.interceptor.js';
import type { Executor, TransactionRunner } from './transaction-runner.js';

const EXECUTOR = Symbol('executor') as unknown as Executor;

function httpContext(auth?: { accountId: string }): ExecutionContext {
	return {
		getType: () => 'http',
		switchToHttp: () => ({ getRequest: () => ({ auth }) }),
	} as unknown as ExecutionContext;
}

describe('TenantTransactionInterceptor', () => {
	let runInAccount: ReturnType<typeof vi.fn>;
	let interceptor: TenantTransactionInterceptor;
	let next: CallHandler;

	beforeEach(() => {
		runInAccount = vi.fn((_accountId: string, work: (executor: Executor) => Promise<unknown>) =>
			work(EXECUTOR),
		);
		interceptor = new TenantTransactionInterceptor({
			runInAccount,
			runAsSystem: vi.fn(),
		} as unknown as TransactionRunner);
		next = { handle: vi.fn(() => of('handled')) };
	});

	it('opens the request transaction for the account the token names', async () => {
		await lastValueFrom(interceptor.intercept(httpContext({ accountId: 'acc-1' }), next));
		expect(runInAccount).toHaveBeenCalledWith('acc-1', expect.any(Function));
	});

	it('passes the handler result through untouched', async () => {
		const result = await lastValueFrom(
			interceptor.intercept(httpContext({ accountId: 'acc-1' }), next),
		);
		expect(result).toBe('handled');
	});

	it('leaves an unauthenticated request alone, because it has no account to scope to', async () => {
		await lastValueFrom(interceptor.intercept(httpContext(), next));
		expect(runInAccount).not.toHaveBeenCalled();
	});

	it('does not nest a second transaction inside one the kernel already opened', async () => {
		await runInScope(EXECUTOR, async () => {
			await lastValueFrom(interceptor.intercept(httpContext({ accountId: 'acc-1' }), next));
		});
		expect(runInAccount).not.toHaveBeenCalled();
	});

	it('stays out of the way of anything that is not an http request', async () => {
		const context = { getType: () => 'rpc' } as unknown as ExecutionContext;
		await lastValueFrom(interceptor.intercept(context, next));
		expect(runInAccount).not.toHaveBeenCalled();
	});
});
