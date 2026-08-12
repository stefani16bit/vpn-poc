import { Injectable } from '@nestjs/common';

import {
	DEFAULT_ROLE_PERMISSIONS,
	USER_ROLES,
	effectivePermissions,
	type Permission,
	type PermissionGrant,
	type RoleGrantsResponse,
} from '@vpn/contracts';

import { AppError } from '../../../shared/errors/app-error.js';
import { UserRepository } from '../../../shared/identity/repositories/user.repository.js';
import type { UserRole } from '../../../shared/identity/user.js';
import { PermissionRepository } from '../../../shared/permissions/repositories/permission.repository.js';
import { PermissionService } from '../../../shared/permissions/permission.service.js';

@Injectable()
export class PermissionsAdminService {
	constructor(
		private readonly grants: PermissionRepository,
		private readonly permissions: PermissionService,
		private readonly users: UserRepository,
	) {}

	async overview(accountId: string): Promise<RoleGrantsResponse> {
		const stored = await this.permissions.grantsOf(accountId);

		const roles = USER_ROLES.map((role) => {
			const own = stored.roles.filter((grant) => grant.role === role);

			return {
				role,
				defaults: [...DEFAULT_ROLE_PERMISSIONS[role]],
				grants: own.flatMap(asGrant),
				effective: effectivePermissions(role, own, []),
			};
		});

		const byUser = new Map<string, PermissionGrant[]>();
		for (const grant of stored.users) {
			byUser.set(grant.userId, [...(byUser.get(grant.userId) ?? []), ...asGrant(grant)]);
		}

		const members = await this.users.listByAccount(accountId);

		return {
			roles,
			users: members
				.filter((member) => member.role !== 'owner')
				.map((member) => ({
					userId: member.id,
					email: member.email,
					role: member.role,
					grants: byUser.get(member.id) ?? [],
				})),
		};
	}

	async setRoleGrant(
		accountId: string,
		role: UserRole,
		grant: PermissionGrant,
	): Promise<RoleGrantsResponse> {
		if (isDefault(role, grant)) await this.grants.clearRoleGrant(accountId, role, grant.permission);
		else await this.grants.setRoleGrant(accountId, role, grant.permission, grant.granted);

		return this.#refreshed(accountId);
	}

	async setUserGrant(
		accountId: string,
		userId: string,
		grant: PermissionGrant,
	): Promise<RoleGrantsResponse> {
		const inherited = await this.#inheritedBy(accountId, userId);

		if (inherited.includes(grant.permission) === grant.granted) {
			await this.grants.clearUserGrant(accountId, userId, grant.permission);
		} else {
			await this.grants.setUserGrant(accountId, userId, grant.permission, grant.granted);
		}

		return this.#refreshed(accountId);
	}

	async #inheritedBy(accountId: string, userId: string): Promise<readonly Permission[]> {
		const user = await this.users.findById(userId);
		if (!user || user.accountId !== accountId) throw new AppError('NOT_FOUND', 'no such user');

		const stored = await this.permissions.grantsOf(accountId);

		return effectivePermissions(
			user.role,
			stored.roles.filter((entry) => entry.role === user.role),
			[],
		);
	}

	async #refreshed(accountId: string): Promise<RoleGrantsResponse> {
		await this.permissions.invalidate(accountId);
		return this.overview(accountId);
	}
}

function asGrant(stored: { permission: string; granted: boolean }): PermissionGrant[] {
	const known = DEFAULT_ROLE_PERMISSIONS.owner.find(
		(permission) => permission === stored.permission,
	);

	return known ? [{ permission: known, granted: stored.granted }] : [];
}

function isDefault(role: UserRole, grant: PermissionGrant): boolean {
	return DEFAULT_ROLE_PERMISSIONS[role].includes(grant.permission) === grant.granted;
}
