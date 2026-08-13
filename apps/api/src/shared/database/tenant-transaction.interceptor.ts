import {
	Injectable,
	type CallHandler,
	type ExecutionContext,
	type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, type Observable } from 'rxjs';

import type { AuthenticatedRequest } from '../access-control/authenticated-request.js';
import { hasScope } from './db-scope.js';
import { SKIP_TENANT_TRANSACTION } from './skip-tenant-transaction.decorator.js';
import { TransactionRunner } from './transaction-runner.js';

@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
	constructor(
		private readonly transactions: TransactionRunner,
		private readonly reflector: Reflector,
	) {}

	intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
		if (context.getType() !== 'http' || hasScope()) return next.handle();

		const skip = this.reflector.getAllAndOverride<boolean>(SKIP_TENANT_TRANSACTION, [
			context.getHandler(),
			context.getClass(),
		]);
		if (skip) return next.handle();

		const accountId = context.switchToHttp().getRequest<AuthenticatedRequest>().auth?.accountId;
		if (!accountId) return next.handle();

		return from(
			this.transactions.runInAccount(accountId, () =>
				lastValueFrom(next.handle(), {
					defaultValue: undefined,
				}),
			),
		);
	}
}
