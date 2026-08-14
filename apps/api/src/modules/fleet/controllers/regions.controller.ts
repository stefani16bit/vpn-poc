import { Controller, Get, UseGuards } from '@nestjs/common';

import type { RegionListResponse } from '@vpn/contracts';

import { AccessTokenGuard } from '../../../shared/access-control/access-token.guard.js';
import { RequiresSubscription } from '../../../shared/access-control/require-subscription.decorator.js';
import { SubscriptionGuard } from '../../../shared/access-control/subscription.guard.js';
import { RegionsService } from '../services/regions.service.js';

// No permission of its own: this is the picker on the key form, and a name plus
// whether a key can be created there is not the fleet. Nothing else about a node
// crosses this boundary — no address, no control url, no count of machines.
@Controller('regions')
export class RegionsController {
	constructor(private readonly regions: RegionsService) {}

	@Get()
	@UseGuards(AccessTokenGuard, SubscriptionGuard)
	@RequiresSubscription()
	async list(): Promise<RegionListResponse> {
		return this.regions.listRegions();
	}
}
