import { Module } from '@nestjs/common';

import { AccessControlModule } from '../../shared/access-control/access-control.module.js';
import { DatabaseModule } from '../../shared/database/database.module.js';
import { moduleLoggerProvider } from '../../shared/http/module-logger.js';
import { OutboxModule } from '../../shared/outbox/outbox.module.js';
import { BillingController } from './controllers/billing.controller.js';
import { BillingEventRepository } from './repositories/billing-event.repository.js';
import { SubscriptionRepository } from './repositories/subscription.repository.js';
import { BillingService } from './services/billing.service.js';

@Module({
	imports: [AccessControlModule, DatabaseModule, OutboxModule],
	controllers: [BillingController],
	providers: [
		moduleLoggerProvider('billing'),
		BillingService,
		SubscriptionRepository,
		BillingEventRepository,
	],
})
export class BillingModule {}
