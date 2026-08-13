import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';

import { InvoiceArchiver } from './invoice-archiver.service.js';
import { InvoiceRepository } from './invoice.repository.js';
import { SubscriptionReconciler } from './subscription-reconciler.service.js';
import { SubscriptionRepository } from './subscription.repository.js';

@Module({
	imports: [DatabaseModule],
	providers: [SubscriptionRepository, InvoiceRepository, InvoiceArchiver, SubscriptionReconciler],
	exports: [SubscriptionRepository, InvoiceRepository, InvoiceArchiver, SubscriptionReconciler],
})
export class SubscriptionsModule {}
