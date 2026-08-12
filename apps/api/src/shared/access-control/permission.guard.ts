import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Permission } from '@vpn/contracts';

import { AppError } from '../errors/app-error.js';
import { PermissionService } from '../permissions/permission.service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { REQUIRED_PERMISSION } from './require-permission.decorator.js';

@Injectable()
export class PermissionGuard implements CanActivate {
	constructor(
		private readonly permissions: PermissionService,
		private readonly reflector: Reflector,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const required = this.reflector.getAllAndOverride<Permission>(REQUIRED_PERMISSION, [
			context.getHandler(),
			context.getClass(),
		]);

		if (!required) return true;

		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		if (!request.auth) {
			throw new AppError(
				'INTERNAL',
				'@RequiresPermission() used on a route with no AccessTokenGuard',
			);
		}

		const allowed = await this.permissions.has(
			request.auth.accountId,
			request.auth.userId,
			request.auth.role,
			required,
		);

		if (!allowed) {
			throw new AppError('FORBIDDEN', `this account does not grant you ${required}`);
		}

		return true;
	}
}
