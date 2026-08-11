import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppError } from '../errors/app-error.js';
import type { UserRole } from '../identity/user.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { REQUIRED_ROLE } from './require-role.decorator.js';
import { hasAtLeastRole } from './roles.js';

@Injectable()
export class RoleGuard implements CanActivate {
	constructor(private readonly reflector: Reflector) {}

	canActivate(context: ExecutionContext): boolean {
		const required = this.reflector.getAllAndOverride<UserRole>(REQUIRED_ROLE, [
			context.getHandler(),
			context.getClass(),
		]);

		if (!required) return true;

		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		if (!request.auth) {
			throw new AppError('INTERNAL', '@RequiresRole() used on a route with no AccessTokenGuard');
		}

		if (!hasAtLeastRole(request.auth.role, required)) {
			throw new AppError('FORBIDDEN', `this route needs at least the ${required} role`);
		}

		return true;
	}
}
