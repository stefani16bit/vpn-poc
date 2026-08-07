import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '@vpn-poc/adapters';
import type { Database } from '@vpn-poc/database';

export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

@Injectable()
export class TransactionRunner {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	run<T>(work: (executor: Executor) => Promise<T>): Promise<T> {
		return this.db.transaction((tx) => work(tx));
	}
}
