import { Module } from '@nestjs/common';

import { AccessControlModule } from '../../shared/access-control/access-control.module.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';

@Module({
	imports: [AccessControlModule],
	controllers: [BillingController],
	providers: [BillingService],
})
export class BillingModule {}
