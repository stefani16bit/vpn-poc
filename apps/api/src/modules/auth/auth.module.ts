import { Module } from '@nestjs/common';

import { AccessControlModule } from '../../shared/access-control/access-control.module.js';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module.js';
import { AuthController } from './controllers/auth.controller.js';
import { RefreshCookie } from './controllers/refresh-cookie.js';
import { AuthMailer } from './services/auth-mailer.service.js';
import { AuthService } from './services/auth.service.js';
import { VerificationTokenService } from './services/verification-token.service.js';

@Module({
	imports: [AccessControlModule, RateLimitModule],
	controllers: [AuthController],
	providers: [AuthService, AuthMailer, VerificationTokenService, RefreshCookie],
})
export class AuthModule {}
