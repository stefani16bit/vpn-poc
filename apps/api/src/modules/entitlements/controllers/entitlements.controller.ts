import { Controller, Get, UseGuards } from '@nestjs/common';

import type { EntitlementsResponse } from '@vpn/contracts';

import { AccessTokenGuard } from '../../../shared/access-control/access-token.guard.js';
import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import { Auth } from '../../../shared/access-control/current-auth.decorator.js';
import { EntitlementsService } from '../../../shared/entitlements/entitlements.service.js';

@Controller('entitlements')
export class EntitlementsController {
	constructor(private readonly entitlements: EntitlementsService) {}

	@Get()
	@UseGuards(AccessTokenGuard)
	async current(@Auth() claims: AccessTokenClaims): Promise<EntitlementsResponse> {
		return this.entitlements.forAccount(claims.accountId);
	}
}
