import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';
import { IDENTITY_PROVIDER, type Account, type IIdentityProvider } from '@vpn/ports';

import { VerificationTokenService } from '../verification/verification-token.service.js';
import type { OutboxMessage } from '../outbox/outbox-message.js';
import { AuthMailer } from './auth-mailer.service.js';
import { BillingMailer } from './billing-mailer.service.js';

@Injectable()
export class NotificationDispatcher {
	constructor(
		@Inject(IDENTITY_PROVIDER) private readonly identity: IIdentityProvider,
		@Inject(ENV) private readonly env: Env,
		private readonly authMailer: AuthMailer,
		private readonly billingMailer: BillingMailer,
		private readonly verificationTokens: VerificationTokenService,
	) {}

	async send(message: OutboxMessage): Promise<void> {
		const account = await this.identity.findById(message.accountId);
		if (!account) return;

		switch (message.kind) {
			case 'auth.verification':
				return this.#sendVerification(account);
			case 'auth.password_reset':
				return this.#sendPasswordReset(account);
			case 'auth.welcome':
				return this.authMailer.sendWelcome(account);
			case 'auth.password_changed':
				return this.authMailer.sendPasswordChanged(account, new Date(message.changedAt));
			case 'billing.payment_failed':
				return this.billingMailer.sendPaymentFailed(account, message.externalEventId);
			case 'billing.subscription_canceled':
				return this.billingMailer.sendSubscriptionCanceled(
					account,
					message.endsAt === null ? null : new Date(message.endsAt),
					message.externalEventId,
				);
		}
	}

	async #sendVerification(account: Account): Promise<void> {
		if (account.emailVerifiedAt) return;

		const ttl = this.env.AUTH_EMAIL_VERIFICATION_TTL;
		const issued = await this.verificationTokens.issue(account.id, 'email_verification', ttl);

		await this.authMailer.sendVerification(account, issued.token, ttl);
	}

	async #sendPasswordReset(account: Account): Promise<void> {
		const ttl = this.env.AUTH_PASSWORD_RESET_TTL;
		const issued = await this.verificationTokens.issue(account.id, 'password_reset', ttl);

		await this.authMailer.sendPasswordReset(account, issued.token, ttl);
	}
}
