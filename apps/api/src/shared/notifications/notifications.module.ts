import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { VerificationModule } from '../verification/verification.module.js';
import { AuthMailer } from './auth-mailer.service.js';
import { BillingMailer } from './billing-mailer.service.js';
import { NotificationDispatcher } from './notification-dispatcher.js';

@Module({
	imports: [DatabaseModule, IdentityModule, VerificationModule],
	providers: [AuthMailer, BillingMailer, NotificationDispatcher],
	exports: [NotificationDispatcher],
})
export class NotificationsModule {}
