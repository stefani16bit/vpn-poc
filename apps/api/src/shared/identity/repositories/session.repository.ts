import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { refreshTokens, sessionFamilies, type Database } from '@vpn-poc/database';

import { currentExecutor } from '../../database/db-scope.js';
import type { Executor } from '../../database/transaction-runner.js';
import type { RotationCandidate } from '../session-rotation.js';

@Injectable()
export class SessionRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async createFamily(
		values: { userId: string; accountId: string },
		executor: Executor = currentExecutor(),
	): Promise<string> {
		const families = await executor
			.insert(sessionFamilies)
			.values(values)
			.returning({ id: sessionFamilies.id });

		const familyId = families[0]?.id;
		if (!familyId) throw new Error('failed to create a session family');

		return familyId;
	}

	async insertToken(
		values: { tokenHash: string; familyId: string; accountId: string; expiresAt: Date },
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor.insert(refreshTokens).values(values);
	}

	async lockByTokenHash(
		tokenHash: string,
		executor: Executor,
	): Promise<RotationCandidate | undefined> {
		const rows = await executor
			.select({
				familyId: refreshTokens.familyId,
				spentAt: refreshTokens.spentAt,
				expiresAt: refreshTokens.expiresAt,
				userId: sessionFamilies.userId,
				accountId: sessionFamilies.accountId,
				revokedAt: sessionFamilies.revokedAt,
			})
			.from(refreshTokens)
			.innerJoin(sessionFamilies, eq(refreshTokens.familyId, sessionFamilies.id))
			.where(eq(refreshTokens.tokenHash, tokenHash))
			.for('update')
			.limit(1);

		return rows[0];
	}

	async spendToken(tokenHash: string, now: Date, executor: Executor): Promise<boolean> {
		const spent = await executor
			.update(refreshTokens)
			.set({ spentAt: now })
			.where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.spentAt)))
			.returning({ tokenHash: refreshTokens.tokenHash });

		return spent.length > 0;
	}

	async familyIdByTokenHash(
		tokenHash: string,
		executor: Executor = currentExecutor(),
	): Promise<string | undefined> {
		const rows = await executor
			.select({ familyId: refreshTokens.familyId })
			.from(refreshTokens)
			.where(eq(refreshTokens.tokenHash, tokenHash))
			.limit(1);

		return rows[0]?.familyId;
	}

	async revokeFamily(
		familyId: string,
		now: Date,
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor
			.update(sessionFamilies)
			.set({ revokedAt: now })
			.where(and(eq(sessionFamilies.id, familyId), isNull(sessionFamilies.revokedAt)));
	}

	async revokeAllForUser(
		userId: string,
		now: Date,
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor
			.update(sessionFamilies)
			.set({ revokedAt: now })
			.where(and(eq(sessionFamilies.userId, userId), isNull(sessionFamilies.revokedAt)));
	}
}
