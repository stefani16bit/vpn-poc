import { Module } from '@nestjs/common';

import { InvoiceArchiver } from './invoice-archiver.service.js';
import { InvoiceRepository } from './invoice.repository.js';
import { SubscriptionRepository } from './subscription.repository.js';

@Module({
	providers: [SubscriptionRepository, InvoiceRepository, InvoiceArchiver],
	exports: [SubscriptionRepository, InvoiceRepository, InvoiceArchiver],
})
export class SubscriptionsModule {}
