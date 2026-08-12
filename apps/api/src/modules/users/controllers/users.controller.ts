import {
	Body,
	Controller,
	Delete,
	Get,
	HttpCode,
	Param,
	Patch,
	Post,
	UseGuards,
} from '@nestjs/common';

import {
	createUserRequestSchema,
	updateUserRoleRequestSchema,
	type CreateUserRequest,
	type CreateUserResponse,
	type UpdateUserRoleRequest,
	type UserListResponse,
	type UserResponse,
} from '@vpn/contracts';

import { AccessTokenGuard } from '../../../shared/access-control/access-token.guard.js';
import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import { Auth } from '../../../shared/access-control/current-auth.decorator.js';
import { PermissionGuard } from '../../../shared/access-control/permission.guard.js';
import { RequiresPermission } from '../../../shared/access-control/require-permission.decorator.js';
import { ZodBody } from '../../../shared/validation/zod-body.pipe.js';
import { UsersService } from '../services/users.service.js';

@Controller('users')
@UseGuards(AccessTokenGuard, PermissionGuard)
export class UsersController {
	constructor(private readonly users: UsersService) {}

	@Get()
	@RequiresPermission('users.read')
	async list(@Auth() claims: AccessTokenClaims): Promise<UserListResponse> {
		return this.users.list(claims);
	}

	@Post()
	@HttpCode(201)
	@RequiresPermission('users.create')
	async create(
		@Auth() claims: AccessTokenClaims,
		@Body(new ZodBody(createUserRequestSchema)) body: CreateUserRequest,
	): Promise<CreateUserResponse> {
		return this.users.create(claims, body);
	}

	@Patch(':id')
	@RequiresPermission('users.update')
	async changeRole(
		@Auth() claims: AccessTokenClaims,
		@Param('id') id: string,
		@Body(new ZodBody(updateUserRoleRequestSchema)) body: UpdateUserRoleRequest,
	): Promise<UserResponse> {
		return this.users.changeRole(claims, id, body.role);
	}

	@Delete(':id')
	@HttpCode(204)
	@RequiresPermission('users.delete')
	async remove(@Auth() claims: AccessTokenClaims, @Param('id') id: string): Promise<void> {
		await this.users.remove(claims, id);
	}
}
