import { Body, Controller, Get, HttpCode, Param, Put, UseGuards } from '@nestjs/common';

import {
	permissionGrantSchema,
	roleSchema,
	type PermissionGrant,
	type PermissionsResponse,
	type RoleGrantsResponse,
} from '@vpn/contracts';

import { AccessTokenGuard } from '../../../shared/access-control/access-token.guard.js';
import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import { Auth } from '../../../shared/access-control/current-auth.decorator.js';
import { PermissionGuard } from '../../../shared/access-control/permission.guard.js';
import { RequiresPermission } from '../../../shared/access-control/require-permission.decorator.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { PermissionService } from '../../../shared/permissions/permission.service.js';
import { ZodBody } from '../../../shared/validation/zod-body.pipe.js';
import { PermissionsAdminService } from '../services/permissions-admin.service.js';

@Controller('permissions')
export class PermissionsController {
	constructor(
		private readonly permissions: PermissionService,
		private readonly admin: PermissionsAdminService,
	) {}

	@Get()
	@UseGuards(AccessTokenGuard)
	async mine(@Auth() claims: AccessTokenClaims): Promise<PermissionsResponse> {
		return {
			permissions: await this.permissions.forUser(claims.accountId, claims.userId, claims.role),
		};
	}

	@Get('grants')
	@UseGuards(AccessTokenGuard, PermissionGuard)
	@RequiresPermission('permissions.manage')
	async grants(@Auth() claims: AccessTokenClaims): Promise<RoleGrantsResponse> {
		return this.admin.overview(claims.accountId);
	}

	@Put('roles/:role')
	@UseGuards(AccessTokenGuard, PermissionGuard)
	@RequiresPermission('permissions.manage')
	@HttpCode(200)
	async setRoleGrant(
		@Auth() claims: AccessTokenClaims,
		@Param('role') role: string,
		@Body(new ZodBody(permissionGrantSchema)) body: PermissionGrant,
	): Promise<RoleGrantsResponse> {
		const parsed = roleSchema.safeParse(role);
		if (!parsed.success) throw new AppError('NOT_FOUND', `no such role: ${role}`);

		return this.admin.setRoleGrant(claims.accountId, parsed.data, body);
	}

	@Put('users/:id')
	@UseGuards(AccessTokenGuard, PermissionGuard)
	@RequiresPermission('permissions.manage')
	@HttpCode(200)
	async setUserGrant(
		@Auth() claims: AccessTokenClaims,
		@Param('id') id: string,
		@Body(new ZodBody(permissionGrantSchema)) body: PermissionGrant,
	): Promise<RoleGrantsResponse> {
		return this.admin.setUserGrant(claims.accountId, id, body);
	}
}
