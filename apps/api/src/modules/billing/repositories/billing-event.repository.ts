import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '@vpn-poc/adapters';
import { billingEvents, type Database } from '@vpn-poc/database';

@Injectable()
export class BillingEventRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async claim(source: string, externalEventId: string, kind: string): Promise<boolean> {
		const claimed = await this.db
			.insert(billingEvents)
			.values({ source, externalEventId, kind })
			.onConflictDoNothing({
				target: [billingEvents.source, billingEvents.externalEventId],
			})
			.returning({ id: billingEvents.id });

		return claimed.length > 0;
	}
}
