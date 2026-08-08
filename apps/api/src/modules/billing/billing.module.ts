import { Module } from '@nestjs/common';

import { AccessControlModule } from '../../shared/access-control/access-control.module.js';
import { DatabaseModule } from '../../shared/database/database.module.js';
import { IdentityModule } from '../../shared/identity/identity.module.js';
import { moduleLoggerProvider } from '../../shared/http/module-logger.js';
import { OutboxModule } from '../../shared/outbox/outbox.module.js';
import { SubscriptionsModule } from '../../shared/subscriptions/subscriptions.module.js';
import { BillingController } from './controllers/billing.controller.js';
import { BillingEventRepository } from './repositories/billing-event.repository.js';
import { BillingService } from './services/billing.service.js';

@Module({
	imports: [AccessControlModule, DatabaseModule, IdentityModule, OutboxModule, SubscriptionsModule],
	controllers: [BillingController],
	providers: [moduleLoggerProvider('billing'), BillingService, BillingEventRepository],
})
export class BillingModule {}
