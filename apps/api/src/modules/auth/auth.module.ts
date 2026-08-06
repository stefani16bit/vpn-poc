import { Module } from '@nestjs/common';

import { AccessTokenService } from './access-token.service.js';
import { AuthController } from './auth.controller.js';
import { AccessTokenGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { VerificationTokenService } from './verification-token.service.js';

@Module({
	controllers: [AuthController],
	providers: [
		AuthService,
		AccessTokenService,
		VerificationTokenService,
		RateLimitService,
		AccessTokenGuard,
	],
	exports: [AccessTokenService, AccessTokenGuard],
})
export class AuthModule {}
