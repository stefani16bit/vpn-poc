import { Inject, Injectable } from '@nestjs/common';

import { effectivePermissions, type Permission } from '@vpn/contracts';
import { CACHE_STORE, type CacheKey, type ICacheStore } from '@vpn/ports';

import { currentExecutor, hasScope } from '../database/db-scope.js';
import { TransactionRunner, type Executor } from '../database/transaction-runner.js';
import type { UserRole } from '../identity/user.js';
import { PermissionRepository, type AccountGrants } from './repositories/permission.repository.js';

const NAMESPACE = 'permissions';
const TTL_SECONDS = 60;

export function permissionCacheKey(accountId: string): CacheKey {
	return { owner: accountId, namespace: NAMESPACE, id: 'grants' };
}

@Injectable()
export class PermissionService {
	constructor(
		@Inject(CACHE_STORE) private readonly cache: ICacheStore,
		private readonly grants: PermissionRepository,
		private readonly transactions: TransactionRunner,
	) {}

	async forUser(accountId: string, userId: string, role: UserRole): Promise<Permission[]> {
		const grants = await this.#grants(accountId);

		return effectivePermissions(
			role,
			grants.roles.filter((grant) => grant.role === role),
			grants.users.filter((grant) => grant.userId === userId),
		);
	}

	async has(
		accountId: string,
		userId: string,
		role: UserRole,
		permission: Permission,
	): Promise<boolean> {
		return (await this.forUser(accountId, userId, role)).includes(permission);
	}

	async grantsOf(accountId: string): Promise<AccountGrants> {
		return this.#grants(accountId);
	}

	async invalidate(accountId: string): Promise<void> {
		await this.cache.delete(permissionCacheKey(accountId));
	}

	async #grants(accountId: string): Promise<AccountGrants> {
		const cached = await this.cache.get<AccountGrants>(permissionCacheKey(accountId));
		if (cached) return cached;

		const stored = await this.#read(accountId);
		await this.cache.set<AccountGrants>(permissionCacheKey(accountId), stored, TTL_SECONDS);

		return stored;
	}

	#read(accountId: string): Promise<AccountGrants> {
		if (hasScope()) return this.grants.findByAccount(accountId, currentExecutor());

		return this.transactions.runInAccount(accountId, (executor: Executor) =>
			this.grants.findByAccount(accountId, executor),
		);
	}
}
