import {
	type CanActivate,
	type ExecutionContext,
	Injectable,
	SetMetadata,
	createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppError } from '../../common/errors/app-error.js';
import type { AccessTokenClaims } from './access-token.service.js';
import { AccessTokenService } from './access-token.service.js';

export interface AuthenticatedRequest extends Request {
	auth?: AccessTokenClaims;
}

export const ALLOW_UNVERIFIED = 'ALLOW_UNVERIFIED';
export const AllowUnverified = (): MethodDecorator => SetMetadata(ALLOW_UNVERIFIED, true);

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

export const Auth = createParamDecorator((_data: unknown, context: ExecutionContext) => {
	const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
	if (!request.auth) {
		throw new AppError('INTERNAL', '@Auth() used on a route with no AccessTokenGuard');
	}
	return request.auth;
});
