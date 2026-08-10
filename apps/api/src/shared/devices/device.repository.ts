import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { devices, liveTunnelAddresses, type Database } from '@vpn-poc/database';

import { currentExecutor } from '../database/db-scope.js';
import type { Executor } from '../database/transaction-runner.js';

export interface StoredDevice {
	readonly id: string;
	readonly accountId: string;
	readonly userId: string;
	readonly name: string;
	readonly publicKey: string;
	readonly tunnelAddress: string;
	readonly provisionedAt: Date | null;
	readonly revokedAt: Date | null;
	readonly createdAt: Date;
}

export interface NewDevice {
	readonly accountId: string;
	readonly userId: string;
	readonly name: string;
	readonly publicKey: string;
	readonly tunnelAddress: string;
}

@Injectable()
export class DeviceRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async claimAddress(
		values: NewDevice,
		executor: Executor = currentExecutor(),
	): Promise<StoredDevice | undefined> {
		const inserted = await executor
			.insert(devices)
			.values(values)
			.onConflictDoNothing({ target: devices.tunnelAddress, where: isNull(devices.revokedAt) })
			.returning();

		return inserted[0];
	}

	async takenAddresses(executor: Executor = currentExecutor()): Promise<ReadonlySet<string>> {
		const rows = await executor.select().from(liveTunnelAddresses);

		return new Set(rows.map((row) => row.tunnelAddress));
	}

	async listLive(
		userId: string,
		executor: Executor = currentExecutor(),
	): Promise<readonly StoredDevice[]> {
		return executor
			.select()
			.from(devices)
			.where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
			.orderBy(desc(devices.createdAt));
	}

	async findLiveById(
		id: string,
		executor: Executor = currentExecutor(),
	): Promise<StoredDevice | undefined> {
		const rows = await executor
			.select()
			.from(devices)
			.where(and(eq(devices.id, id), isNull(devices.revokedAt)))
			.limit(1);

		return rows[0];
	}

	async findById(
		id: string,
		executor: Executor = currentExecutor(),
	): Promise<StoredDevice | undefined> {
		const rows = await executor.select().from(devices).where(eq(devices.id, id)).limit(1);
		return rows[0];
	}

	async markProvisioned(
		id: string,
		at: Date,
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor
			.update(devices)
			.set({ provisionedAt: at })
			.where(and(eq(devices.id, id), isNull(devices.provisionedAt)));
	}

	async revoke(
		id: string,
		userId: string,
		at: Date,
		executor: Executor = currentExecutor(),
	): Promise<StoredDevice | undefined> {
		const updated = await executor
			.update(devices)
			.set({ revokedAt: at })
			.where(and(eq(devices.id, id), eq(devices.userId, userId), isNull(devices.revokedAt)))
			.returning();

		return updated[0];
	}
}
