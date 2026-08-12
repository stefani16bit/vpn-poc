import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { rolePermissions, userPermissions, type Database } from '@vpn-poc/database';
import type { Permission } from '@vpn/contracts';
import type { UserRole } from '../../identity/user.js';

import { currentExecutor } from '../../database/db-scope.js';
import type { Executor } from '../../database/transaction-runner.js';

export interface StoredRoleGrant {
	readonly role: UserRole;
	readonly permission: string;
	readonly granted: boolean;
}

export interface StoredUserGrant {
	readonly userId: string;
	readonly permission: string;
	readonly granted: boolean;
}

export interface AccountGrants {
	readonly roles: readonly StoredRoleGrant[];
	readonly users: readonly StoredUserGrant[];
}

@Injectable()
export class PermissionRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async findByAccount(
		accountId: string,
		executor: Executor = currentExecutor(),
	): Promise<AccountGrants> {
		const [roles, users] = await Promise.all([
			executor
				.select({
					role: rolePermissions.role,
					permission: rolePermissions.permission,
					granted: rolePermissions.granted,
				})
				.from(rolePermissions)
				.where(eq(rolePermissions.accountId, accountId)),
			executor
				.select({
					userId: userPermissions.userId,
					permission: userPermissions.permission,
					granted: userPermissions.granted,
				})
				.from(userPermissions)
				.where(eq(userPermissions.accountId, accountId)),
		]);

		return { roles, users };
	}

	async setRoleGrant(
		accountId: string,
		role: UserRole,
		permission: Permission,
		granted: boolean,
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor
			.insert(rolePermissions)
			.values({ accountId, role, permission, granted })
			.onConflictDoUpdate({
				target: [rolePermissions.accountId, rolePermissions.role, rolePermissions.permission],
				set: { granted },
			});
	}

	async clearRoleGrant(
		accountId: string,
		role: UserRole,
		permission: Permission,
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor
			.delete(rolePermissions)
			.where(
				and(
					eq(rolePermissions.accountId, accountId),
					eq(rolePermissions.role, role),
					eq(rolePermissions.permission, permission),
				),
			);
	}

	async setUserGrant(
		accountId: string,
		userId: string,
		permission: Permission,
		granted: boolean,
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor
			.insert(userPermissions)
			.values({ accountId, userId, permission, granted })
			.onConflictDoUpdate({
				target: [userPermissions.accountId, userPermissions.userId, userPermissions.permission],
				set: { granted },
			});
	}

	async clearUserGrant(
		accountId: string,
		userId: string,
		permission: Permission,
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor
			.delete(userPermissions)
			.where(
				and(
					eq(userPermissions.accountId, accountId),
					eq(userPermissions.userId, userId),
					eq(userPermissions.permission, permission),
				),
			);
	}
}
