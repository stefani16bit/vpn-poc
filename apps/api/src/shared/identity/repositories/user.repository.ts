import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { users, type Database } from '@vpn-poc/database';

import { currentExecutor } from '../../database/db-scope.js';
import type { Executor } from '../../database/transaction-runner.js';
import type { User, UserRole } from '../user.js';

export interface StoredUser extends User {
	readonly passwordHash: string;
}

@Injectable()
export class UserRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async insert(
		values: {
			accountId: string;
			email: string;
			passwordHash: string;
			role: UserRole;
			locale: string;
		},
		executor: Executor = currentExecutor(),
	): Promise<StoredUser | undefined> {
		const inserted = await executor.insert(users).values(values).onConflictDoNothing().returning();

		return toStoredUser(inserted[0]);
	}

	async findByEmail(
		email: string,
		executor: Executor = currentExecutor(),
	): Promise<StoredUser | undefined> {
		const rows = await executor.select().from(users).where(eq(users.email, email)).limit(2);

		return rows.length === 1 ? toStoredUser(rows[0]) : undefined;
	}

	async findByAccountAndEmail(
		accountId: string,
		email: string,
		executor: Executor = currentExecutor(),
	): Promise<StoredUser | undefined> {
		const rows = await executor
			.select()
			.from(users)
			.where(and(eq(users.accountId, accountId), eq(users.email, email)))
			.limit(1);

		return toStoredUser(rows[0]);
	}

	async findById(
		id: string,
		executor: Executor = currentExecutor(),
	): Promise<StoredUser | undefined> {
		const rows = await executor.select().from(users).where(eq(users.id, id)).limit(1);
		return toStoredUser(rows[0]);
	}

	async findOwner(
		accountId: string,
		executor: Executor = currentExecutor(),
	): Promise<StoredUser | undefined> {
		const rows = await executor
			.select()
			.from(users)
			.where(and(eq(users.accountId, accountId), eq(users.role, 'owner')))
			.limit(1);

		return toStoredUser(rows[0]);
	}

	async updatePasswordHash(
		id: string,
		passwordHash: string,
		now: Date,
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, id));
	}

	async setLocale(
		id: string,
		locale: string,
		now: Date,
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor.update(users).set({ locale, updatedAt: now }).where(eq(users.id, id));
	}

	async markEmailVerified(
		id: string,
		now: Date,
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor
			.update(users)
			.set({ emailVerifiedAt: now, updatedAt: now })
			.where(and(eq(users.id, id), isNull(users.emailVerifiedAt)));
	}
}

function toStoredUser(row: typeof users.$inferSelect | undefined): StoredUser | undefined {
	if (!row) return undefined;

	return {
		id: row.id,
		accountId: row.accountId,
		email: row.email,
		passwordHash: row.passwordHash,
		role: row.role,
		emailVerifiedAt: row.emailVerifiedAt,
		locale: row.locale,
		createdAt: row.createdAt,
	};
}
