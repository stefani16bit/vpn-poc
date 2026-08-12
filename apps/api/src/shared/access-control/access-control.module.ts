import { Module } from '@nestjs/common';

import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { AccessTokenService } from './access-token.service.js';
import { CapabilityGuard } from './capability.guard.js';
import { PermissionGuard } from './permission.guard.js';
import { SubscriptionGuard } from './subscription.guard.js';

@Module({
	imports: [EntitlementsModule, PermissionsModule],
	providers: [
		AccessTokenService,
		AccessTokenGuard,
		CapabilityGuard,
		PermissionGuard,
		SubscriptionGuard,
	],
	exports: [
		AccessTokenService,
		AccessTokenGuard,
		CapabilityGuard,
		PermissionGuard,
		SubscriptionGuard,
		EntitlementsModule,
		PermissionsModule,
	],
})
export class AccessControlModule {}
