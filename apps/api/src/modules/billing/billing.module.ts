import { Module } from '@nestjs/common';

import { AccessControlModule } from '../../shared/access-control/access-control.module.js';
import { BillingController } from './controllers/billing.controller.js';
import { BillingEventRepository } from './repositories/billing-event.repository.js';
import { SubscriptionRepository } from './repositories/subscription.repository.js';
import { BillingMailer } from './services/billing-mailer.service.js';
import { BillingService } from './services/billing.service.js';

@Module({
	imports: [AccessControlModule],
	controllers: [BillingController],
	providers: [BillingService, BillingMailer, SubscriptionRepository, BillingEventRepository],
})
export class BillingModule {}
