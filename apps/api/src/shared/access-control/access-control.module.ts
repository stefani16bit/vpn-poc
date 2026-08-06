import { Module } from '@nestjs/common';

import { AccessTokenGuard } from './access-token.guard.js';
import { AccessTokenService } from './access-token.service.js';

@Module({
	providers: [AccessTokenService, AccessTokenGuard],
	exports: [AccessTokenService, AccessTokenGuard],
})
export class AccessControlModule {}
