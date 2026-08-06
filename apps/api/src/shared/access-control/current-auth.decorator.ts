import { type ExecutionContext, createParamDecorator } from '@nestjs/common';

import { AppError } from '../errors/app-error.js';
import type { AccessTokenClaims } from './access-token.service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';

export function currentAuth(_data: unknown, context: ExecutionContext): AccessTokenClaims {
	const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
	if (!request.auth) {
		throw new AppError('INTERNAL', '@Auth() used on a route with no AccessTokenGuard');
	}
	return request.auth;
}

export const Auth = createParamDecorator(currentAuth);
