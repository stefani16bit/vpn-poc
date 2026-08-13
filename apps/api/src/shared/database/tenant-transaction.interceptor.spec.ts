import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { runInScope } from './db-scope.js';
import { SKIP_TENANT_TRANSACTION } from './skip-tenant-transaction.decorator.js';
import { TenantTransactionInterceptor } from './tenant-transaction.interceptor.js';
import type { Executor, TransactionRunner } from './transaction-runner.js';

const EXECUTOR = Symbol('executor') as unknown as Executor;

function httpContext(auth?: { accountId: string }, handler: () => void = () => undefined) {
	return {
		getType: () => 'http',
		getHandler: () => handler,
		getClass: () => class Controller {},
		switchToHttp: () => ({ getRequest: () => ({ auth }) }),
	} as unknown as ExecutionContext;
}

// What @SkipTenantTransaction() leaves behind, without pulling Nest's decorator
// plumbing into a unit test.
function skipping(): () => void {
	const handler = (): undefined => undefined;
	Reflect.defineMetadata(SKIP_TENANT_TRANSACTION, true, handler);
	return handler;
}

describe('TenantTransactionInterceptor', () => {
	let runInAccount: ReturnType<typeof vi.fn>;
	let interceptor: TenantTransactionInterceptor;
	let next: CallHandler;

	beforeEach(() => {
		runInAccount = vi.fn((_accountId: string, work: (executor: Executor) => Promise<unknown>) =>
			work(EXECUTOR),
		);
		interceptor = new TenantTransactionInterceptor(
			{ runInAccount, runAsSystem: vi.fn() } as unknown as TransactionRunner,
			new Reflector(),
		);
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

	// The handler that talks to a payment provider: the connection is the scarce
	// thing, and holding one across that round trip is what this opts out of.
	it('leaves a handler that opted out to open its own transaction', async () => {
		await lastValueFrom(
			interceptor.intercept(httpContext({ accountId: 'acc-1' }, skipping()), next),
		);

		expect(runInAccount).not.toHaveBeenCalled();
	});
});
