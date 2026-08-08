import { Module } from '@nestjs/common';

import { SubscriptionRepository } from './subscription.repository.js';

@Module({
	providers: [SubscriptionRepository],
	exports: [SubscriptionRepository],
})
export class SubscriptionsModule {}
