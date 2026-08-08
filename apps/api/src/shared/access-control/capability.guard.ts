import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Capability } from '@vpn/contracts';

import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { AppError } from '../errors/app-error.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { REQUIRED_CAPABILITY } from './require-capability.decorator.js';

@Injectable()
export class CapabilityGuard implements CanActivate {
	constructor(
		private readonly entitlements: EntitlementsService,
		private readonly reflector: Reflector,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const required = this.reflector.getAllAndOverride<Capability>(REQUIRED_CAPABILITY, [
			context.getHandler(),
			context.getClass(),
		]);

		if (!required) return true;

		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		if (!request.auth) {
			throw new AppError(
				'INTERNAL',
				'@RequiresCapability() used on a route with no AccessTokenGuard',
			);
		}

		const { entitlements } = await this.entitlements.forAccount(request.auth.accountId);
		if (!entitlements.capabilities.includes(required)) {
			throw new AppError(
				'PAYMENT_REQUIRED',
				`the plan of this account does not include ${required}`,
			);
		}

		return true;
	}
}
