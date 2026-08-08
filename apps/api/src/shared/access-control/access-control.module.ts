import { Module } from '@nestjs/common';

import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { AccessTokenService } from './access-token.service.js';
import { CapabilityGuard } from './capability.guard.js';

@Module({
	imports: [EntitlementsModule],
	providers: [AccessTokenService, AccessTokenGuard, CapabilityGuard],
	exports: [AccessTokenService, AccessTokenGuard, CapabilityGuard, EntitlementsModule],
})
export class AccessControlModule {}
