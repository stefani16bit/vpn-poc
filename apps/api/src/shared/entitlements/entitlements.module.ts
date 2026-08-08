import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { EntitlementsService } from './entitlements.service.js';

@Module({
	imports: [DatabaseModule, SubscriptionsModule],
	providers: [EntitlementsService],
	exports: [EntitlementsService],
})
export class EntitlementsModule {}
