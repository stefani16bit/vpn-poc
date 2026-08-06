import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AppError } from '../errors/app-error.js';
import { AccessTokenService } from './access-token.service.js';
import { ALLOW_UNVERIFIED } from './allow-unverified.decorator.js';
import type { AuthenticatedRequest } from './authenticated-request.js';

@Injectable()
export class AccessTokenGuard implements CanActivate {
	constructor(
		private readonly accessTokens: AccessTokenService,
		private readonly reflector: Reflector,
	) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

		const header = request.headers.authorization;
		if (!header?.startsWith('Bearer ')) {
			throw new AppError('UNAUTHENTICATED', 'authorization header is missing');
		}

		const claims = await this.accessTokens.verify(header.slice('Bearer '.length));

		const allowUnverified = this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED, [
			context.getHandler(),
			context.getClass(),
		]);

		if (!claims.emailVerified && !allowUnverified) {
			throw new AppError('EMAIL_NOT_VERIFIED', 'confirm your e-mail address to continue');
		}

		request.auth = claims;
		return true;
	}
}
