import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { VerificationModule } from '../verification/verification.module.js';
import { AuthMailer } from './auth-mailer.service.js';
import { BillingMailer } from './billing-mailer.service.js';
import { NotificationConsumer } from './notification-consumer.js';
import { NotificationDispatcher } from './notification-dispatcher.js';

@Module({
	imports: [DatabaseModule, IdentityModule, VerificationModule],
	providers: [AuthMailer, BillingMailer, NotificationDispatcher, NotificationConsumer],
	exports: [NotificationDispatcher, NotificationConsumer],
})
export class NotificationsModule {}
