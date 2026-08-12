import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { EntitlementsService } from '../entitlements/entitlements.service.js';
import { AppError } from '../errors/app-error.js';
import type { AuthenticatedRequest } from './authenticated-request.js';
import { REQUIRED_SUBSCRIPTION } from './require-subscription.decorator.js';

@Injectable()
export class SubscriptionGuard implements CanActivate {
	constructor(
		private readonly entitlements: EntitlementsService,
		private readonly reflector: Reflector,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const required = this.reflector.getAllAndOverride<boolean>(REQUIRED_SUBSCRIPTION, [
			context.getHandler(),
			context.getClass(),
		]);

		if (!required) return true;

		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
		if (!request.auth) {
			throw new AppError(
				'INTERNAL',
				'@RequiresSubscription() used on a route with no AccessTokenGuard',
			);
		}

		const { tier } = await this.entitlements.forAccount(request.auth.accountId);
		if (tier === null) {
			throw new AppError('PAYMENT_REQUIRED', 'this area needs an active subscription');
		}

		return true;
	}
}
