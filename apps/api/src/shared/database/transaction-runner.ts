import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import type { Database } from '@vpn-poc/database';

import { runInScope } from './db-scope.js';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

@Injectable()
export class TransactionRunner {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	runInAccount<T>(accountId: string, work: (executor: Executor) => Promise<T>): Promise<T> {
		return this.db.transaction(async (tx) => {
			await tx.execute(sql`select set_config('app.account_id', ${accountId}, true)`);
			return runInScope(tx, () => work(tx));
		});
	}

	runAsSystem<T>(work: (executor: Executor) => Promise<T>): Promise<T> {
		return this.db.transaction(async (tx) => {
			await tx.execute(sql`set local role app_system`);
			return runInScope(tx, () => work(tx));
		});
	}
}
