import { type ExecutionContext, createParamDecorator } from '@nestjs/common';

import { AppError } from '../errors/app-error.js';
import type { AuthenticatedRequest } from './authenticated-request.js';

export const Auth = createParamDecorator((_data: unknown, context: ExecutionContext) => {
	const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
	if (!request.auth) {
		throw new AppError('INTERNAL', '@Auth() used on a route with no AccessTokenGuard');
	}
	return request.auth;
});
