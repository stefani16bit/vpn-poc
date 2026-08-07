import { Module } from '@nestjs/common';

import { AccessControlModule } from '../../shared/access-control/access-control.module.js';
import { moduleLoggerProvider } from '../../shared/http/module-logger.js';
import { OutboxModule } from '../../shared/outbox/outbox.module.js';
import { VerificationModule } from '../../shared/verification/verification.module.js';
import { RateLimitModule } from '../../shared/rate-limit/rate-limit.module.js';
import { AuthController } from './controllers/auth.controller.js';
import { RefreshCookie } from './controllers/refresh-cookie.js';
import { AuthService } from './services/auth.service.js';

@Module({
	imports: [AccessControlModule, RateLimitModule, OutboxModule, VerificationModule],
	controllers: [AuthController],
	providers: [moduleLoggerProvider('auth'), AuthService, RefreshCookie],
})
export class AuthModule {}
