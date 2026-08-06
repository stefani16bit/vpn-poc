import { Module } from '@nestjs/common';

import { AccessControlModule } from '../../shared/access-control/access-control.module.js';
import { BillingController } from './controllers/billing.controller.js';
import { BillingService } from './services/billing.service.js';

@Module({
	imports: [AccessControlModule],
	controllers: [BillingController],
	providers: [BillingService],
})
export class BillingModule {}
