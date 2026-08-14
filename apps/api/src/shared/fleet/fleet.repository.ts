import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, sql } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { devices, exitNodes, regions, type Database } from '@vpn-poc/database';

import { currentExecutor } from '../database/db-scope.js';
import type { Executor } from '../database/transaction-runner.js';

export interface StoredExitNode {
	readonly id: string;
	readonly regionId: string;
	readonly label: string;
	readonly endpoint: string;
	readonly controlUrl: string;
	readonly publicKey: string;
	readonly tunnelCidr: string;
	readonly credentialRef: string;
	readonly lastSeenAt: Date | null;
	readonly createdAt: Date;
}

export interface AvailableRegion {
	readonly id: string;
	readonly name: string;
	readonly available: boolean;
}

// What placing a device needs off a node, which is not what dialling it needs:
// the credential ref stays out because nothing on the request path resolves it.
export interface PlacementNode {
	readonly id: string;
	readonly publicKey: string;
	readonly endpoint: string;
	readonly tunnelCidr: string;
}

@Injectable()
export class FleetRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	// available is decided here and not on the client: the picker has to agree
	// with the node this same window will pick, or it offers a region the next
	// call refuses.
	//
	// The staleness bound goes through gte() rather than into the template by
	// hand. Inside a raw sql`` there is no column to infer the type from, the
	// Date reaches the driver unencoded, and the bind fails at runtime with
	// nothing red to have caught it.
	async listRegions(
		staleBefore: Date,
		executor: Executor = currentExecutor(),
	): Promise<readonly AvailableRegion[]> {
		const rows = await executor
			.select({
				id: regions.id,
				name: regions.name,
				available: sql<boolean>`count(${exitNodes.id}) filter (where ${gte(exitNodes.lastSeenAt, staleBefore)}) > 0`,
			})
			.from(regions)
			.leftJoin(exitNodes, eq(exitNodes.regionId, regions.id))
			.groupBy(regions.id)
			.orderBy(asc(regions.name));

		return rows.map((row) => ({ ...row, available: Boolean(row.available) }));
	}

	async listNodes(executor: Executor = currentExecutor()): Promise<readonly PlacementNode[]> {
		return executor
			.select({
				id: exitNodes.id,
				publicKey: exitNodes.publicKey,
				endpoint: exitNodes.endpoint,
				tunnelCidr: exitNodes.tunnelCidr,
			})
			.from(exitNodes)
			.orderBy(asc(exitNodes.label));
	}

	// The node a new device lands on. Silent nodes are excluded here rather than
	// filtered by the caller: a node that stopped answering the control plane
	// cannot be told about the peer we are about to promise.
	//
	// Least loaded first, so one node does not absorb a region until its range is
	// exhausted while the others sit empty. createdAt breaks the tie, so an empty
	// region is still deterministic.
	async pickNodeInRegion(
		regionId: string,
		staleBefore: Date,
		executor: Executor = currentExecutor(),
	): Promise<PlacementNode | undefined> {
		const [row] = await executor
			.select({
				id: exitNodes.id,
				publicKey: exitNodes.publicKey,
				endpoint: exitNodes.endpoint,
				tunnelCidr: exitNodes.tunnelCidr,
			})
			.from(exitNodes)
			.leftJoin(devices, eq(devices.exitNodeId, exitNodes.id))
			.where(and(eq(exitNodes.regionId, regionId), gte(exitNodes.lastSeenAt, staleBefore)))
			.groupBy(exitNodes.id)
			.orderBy(
				asc(sql`count(${devices.id}) filter (where ${devices.revokedAt} is null)`),
				asc(exitNodes.createdAt),
			)
			.limit(1);

		return row;
	}

	// Every node, for the sweep that runs as system.
	async listAllNodes(executor: Executor = currentExecutor()): Promise<readonly StoredExitNode[]> {
		return executor.select().from(exitNodes).orderBy(asc(exitNodes.createdAt));
	}

	async findNode(
		id: string,
		executor: Executor = currentExecutor(),
	): Promise<StoredExitNode | undefined> {
		const [row] = await executor.select().from(exitNodes).where(eq(exitNodes.id, id)).limit(1);

		return row;
	}

	async markSeen(id: string, at: Date, executor: Executor = currentExecutor()): Promise<void> {
		await executor.update(exitNodes).set({ lastSeenAt: at }).where(eq(exitNodes.id, id));
	}
}
