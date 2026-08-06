import { Module } from '@nestjs/common';

import { AccessControlModule } from '../../shared/access-control/access-control.module.js';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { VerificationTokenService } from './verification-token.service.js';

@Module({
	imports: [AccessControlModule, RateLimitModule],
	controllers: [AuthController],
	providers: [AuthService, VerificationTokenService],
})
export class AuthModule {}
