import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { devices, users, type Database } from '@vpn-poc/database';

import { currentExecutor } from '../database/db-scope.js';
import type { Executor } from '../database/transaction-runner.js';

export interface StoredDevice {
	readonly id: string;
	readonly accountId: string;
	readonly userId: string;
	readonly name: string;
	readonly publicKey: string;
	readonly tunnelAddress: string;
	readonly regionId: string | null;
	readonly exitNodeId: string | null;
	readonly provisionedAt: Date | null;
	readonly revokedAt: Date | null;
	readonly createdAt: Date;
}

export interface OwnedDevice extends StoredDevice {
	readonly userEmail: string;
}

export type DeviceScope = { readonly ownedBy: string } | { readonly wholeAccount: true };

export interface NewDevice {
	readonly accountId: string;
	readonly userId: string;
	readonly name: string;
	readonly publicKey: string;
	readonly tunnelAddress: string;
	readonly regionId: string;
	readonly exitNodeId: string;
	readonly accountSlot: number;
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
			.onConflictDoNothing({
				target: [devices.exitNodeId, devices.tunnelAddress],
				where: isNull(devices.revokedAt),
			})
			.returning();

		return inserted[0];
	}

	// A hint, like takenAddresses is a hint: the unique index decides, and this
	// only spares the loop from starting at zero every time.
	async takenSlots(
		accountId: string,
		executor: Executor = currentExecutor(),
	): Promise<ReadonlySet<number>> {
		const rows = await executor
			.select({ accountSlot: devices.accountSlot })
			.from(devices)
			.where(and(eq(devices.accountId, accountId), isNull(devices.revokedAt)));

		return new Set(rows.map((row) => row.accountSlot));
	}

	// Per node, because two nodes are independent networks and the same address
	// on both is two different devices. The unique index decides; this only
	// spares the loop from starting at the bottom of the range every time.
	async takenAddresses(
		exitNodeId: string,
		executor: Executor = currentExecutor(),
	): Promise<ReadonlySet<string>> {
		const rows = await executor
			.select({ tunnelAddress: devices.tunnelAddress })
			.from(devices)
			.where(and(eq(devices.exitNodeId, exitNodeId), isNull(devices.revokedAt)));

		return new Set(rows.map((row) => row.tunnelAddress));
	}

	async listLive(
		scope: DeviceScope,
		executor: Executor = currentExecutor(),
	): Promise<readonly OwnedDevice[]> {
		return executor
			.select({
				id: devices.id,
				accountId: devices.accountId,
				userId: devices.userId,
				userEmail: users.email,
				name: devices.name,
				publicKey: devices.publicKey,
				tunnelAddress: devices.tunnelAddress,
				regionId: devices.regionId,
				exitNodeId: devices.exitNodeId,
				provisionedAt: devices.provisionedAt,
				revokedAt: devices.revokedAt,
				createdAt: devices.createdAt,
			})
			.from(devices)
			.innerJoin(users, eq(users.id, devices.userId))
			.where(and(ownerOf(scope), isNull(devices.revokedAt)))
			.orderBy(desc(devices.createdAt));
	}

	async listLiveAcrossAccounts(
		executor: Executor = currentExecutor(),
	): Promise<readonly StoredDevice[]> {
		return executor.select().from(devices).where(isNull(devices.revokedAt));
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
		scope: DeviceScope,
		at: Date,
		executor: Executor = currentExecutor(),
	): Promise<StoredDevice | undefined> {
		const updated = await executor
			.update(devices)
			.set({ revokedAt: at })
			.where(and(eq(devices.id, id), ownerOf(scope), isNull(devices.revokedAt)))
			.returning();

		return updated[0];
	}
}

function ownerOf(scope: DeviceScope): SQL {
	return 'wholeAccount' in scope ? sql`true` : eq(devices.userId, scope.ownedBy);
}
