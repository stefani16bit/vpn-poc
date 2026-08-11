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
import { RequiresRole } from '../../../shared/access-control/require-role.decorator.js';
import { RoleGuard } from '../../../shared/access-control/role.guard.js';
import { ZodBody } from '../../../shared/validation/zod-body.pipe.js';
import { UsersService } from '../services/users.service.js';

@Controller('users')
@UseGuards(AccessTokenGuard, RoleGuard)
export class UsersController {
	constructor(private readonly users: UsersService) {}

	@Get()
	@RequiresRole('admin')
	async list(@Auth() claims: AccessTokenClaims): Promise<UserListResponse> {
		return this.users.list(claims);
	}

	@Post()
	@HttpCode(201)
	@RequiresRole('admin')
	async create(
		@Auth() claims: AccessTokenClaims,
		@Body(new ZodBody(createUserRequestSchema)) body: CreateUserRequest,
	): Promise<CreateUserResponse> {
		return this.users.create(claims, body);
	}

	@Patch(':id')
	@RequiresRole('admin')
	async changeRole(
		@Auth() claims: AccessTokenClaims,
		@Param('id') id: string,
		@Body(new ZodBody(updateUserRoleRequestSchema)) body: UpdateUserRoleRequest,
	): Promise<UserResponse> {
		return this.users.changeRole(claims, id, body.role);
	}

	@Delete(':id')
	@HttpCode(204)
	@RequiresRole('admin')
	async remove(@Auth() claims: AccessTokenClaims, @Param('id') id: string): Promise<void> {
		await this.users.remove(claims, id);
	}
}
