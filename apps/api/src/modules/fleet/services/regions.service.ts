import { Inject, Injectable } from '@nestjs/common';

import { STALE_AFTER_SECONDS, type RegionListResponse } from '@vpn/contracts';
import { CLOCK, type IClock } from '@vpn/ports';

import { FleetRepository } from '../../../shared/fleet/fleet.repository.js';

@Injectable()
export class RegionsService {
	constructor(
		private readonly fleet: FleetRepository,
		@Inject(CLOCK) private readonly clock: IClock,
	) {}

	async listRegions(): Promise<RegionListResponse> {
		return { regions: [...(await this.fleet.listRegions(this.#staleBefore()))] };
	}

	#staleBefore(): Date {
		return new Date(this.clock.now().getTime() - STALE_AFTER_SECONDS * 1000);
	}
}
