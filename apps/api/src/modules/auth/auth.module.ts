import { Module } from '@nestjs/common';

import { AccessControlModule } from '../../shared/access-control/access-control.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { RateLimitService } from './rate-limit.service.js';
import { VerificationTokenService } from './verification-token.service.js';

@Module({
	imports: [AccessControlModule],
	controllers: [AuthController],
	providers: [AuthService, VerificationTokenService, RateLimitService],
})
export class AuthModule {}
