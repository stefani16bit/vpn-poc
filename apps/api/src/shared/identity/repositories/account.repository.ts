import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { accounts, type Database } from '@vpn-poc/database';

import { currentExecutor } from '../../database/db-scope.js';
import type { Executor } from '../../database/transaction-runner.js';

export interface StoredAccount {
	readonly id: string;
	readonly slug: string;
	readonly name: string;
	readonly createdAt: Date;
}

@Injectable()
export class AccountRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async claimSlug(
		values: { slug: string; name: string },
		executor: Executor = currentExecutor(),
	): Promise<StoredAccount | undefined> {
		const inserted = await executor
			.insert(accounts)
			.values(values)
			.onConflictDoNothing({ target: accounts.slug })
			.returning();

		return inserted[0];
	}

	async findBySlug(
		slug: string,
		executor: Executor = currentExecutor(),
	): Promise<StoredAccount | undefined> {
		const rows = await executor.select().from(accounts).where(eq(accounts.slug, slug)).limit(1);
		return rows[0];
	}

	async findById(
		id: string,
		executor: Executor = currentExecutor(),
	): Promise<StoredAccount | undefined> {
		const rows = await executor.select().from(accounts).where(eq(accounts.id, id)).limit(1);
		return rows[0];
	}
}
