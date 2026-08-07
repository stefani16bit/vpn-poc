import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import type { Database } from '@vpn-poc/database';

import { hasScope, runInScope } from './db-scope.js';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

export interface Discovery {
	readonly accountId: string;
}

@Injectable()
export class TransactionRunner {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	runInAccount<T>(accountId: string, work: (executor: Executor) => Promise<T>): Promise<T> {
		return this.db.transaction(async (tx) => {
			await scopeTo(tx, accountId);
			return runInScope(tx, () => work(tx));
		});
	}

	runAsSystem<T>(work: (executor: Executor) => Promise<T>): Promise<T> {
		refuseNestedSystemRole();

		return this.db.transaction(async (tx) => {
			await tx.execute(sql`set local role app_system`);
			return runInScope(tx, () => work(tx));
		});
	}

	runInDiscoveredAccount<D extends Discovery, T>(
		discover: (executor: Executor) => Promise<D | undefined>,
		work: (discovered: D, executor: Executor) => Promise<T>,
	): Promise<T | undefined> {
		refuseNestedSystemRole();

		return this.db.transaction((tx) =>
			runInScope(tx, async () => {
				await tx.execute(sql`set local role app_system`);

				const discovered = await discover(tx);
				if (!discovered) return undefined;

				await tx.execute(sql`reset role`);
				await scopeTo(tx, discovered.accountId);

				return work(discovered, tx);
			}),
		);
	}
}

function scopeTo(tx: Transaction, accountId: string): Promise<unknown> {
	return tx.execute(sql`select set_config('app.account_id', ${accountId}, true)`);
}

function refuseNestedSystemRole(): void {
	if (!hasScope()) return;

	throw new Error(
		'refusing to assume app_system inside an open transaction: `set local role` ' +
			'survives the savepoint that set it, so the rest of the request would keep ' +
			'system privileges and silently escape every policy',
	);
}
