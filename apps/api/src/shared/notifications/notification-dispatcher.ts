import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';
import { UserRepository } from '../identity/repositories/user.repository.js';
import type { User } from '../identity/user.js';
import { VerificationTokenService } from '../verification/verification-token.service.js';
import type { OutboxMessage } from '../outbox/outbox-message.js';
import { AuthMailer } from './auth-mailer.service.js';
import { BillingMailer } from './billing-mailer.service.js';

@Injectable()
export class NotificationDispatcher {
	constructor(
		private readonly users: UserRepository,
		@Inject(ENV) private readonly env: Env,
		private readonly authMailer: AuthMailer,
		private readonly billingMailer: BillingMailer,
		private readonly verificationTokens: VerificationTokenService,
	) {}

	async send(message: OutboxMessage): Promise<void> {
		const account = await this.#recipientOf(message);
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
			case 'billing.subscription_activated':
				return this.billingMailer.sendSubscriptionActivated(account, message.externalEventId);
			case 'billing.subscription_canceled':
				return this.billingMailer.sendSubscriptionCanceled(account, message.externalEventId);
			case 'billing.access_revoked':
				return this.billingMailer.sendAccessRevoked(account, message.externalEventId);
			case 'billing.cancellation_scheduled':
				return this.billingMailer.sendCancellationScheduled(
					account,
					message.endsAt === null ? null : new Date(message.endsAt),
					new Date(message.requestedAt),
				);
			case 'billing.subscription_resumed':
				return this.billingMailer.sendSubscriptionResumed(account, new Date(message.requestedAt));
		}
	}

	async #recipientOf(message: OutboxMessage): Promise<User | undefined> {
		switch (message.kind) {
			case 'auth.verification':
			case 'auth.password_reset':
			case 'auth.welcome':
			case 'auth.password_changed':
				return this.users.findById(message.userId);
			case 'billing.payment_failed':
			case 'billing.subscription_activated':
			case 'billing.subscription_canceled':
			case 'billing.access_revoked':
			case 'billing.cancellation_scheduled':
			case 'billing.subscription_resumed':
				return this.users.findOwner(message.accountId);
		}
	}

	async #sendVerification(account: User): Promise<void> {
		if (account.emailVerifiedAt) return;

		const ttl = this.env.AUTH_EMAIL_VERIFICATION_TTL;
		const issued = await this.verificationTokens.issue(account, 'email_verification', ttl);

		await this.authMailer.sendVerification(account, issued.token, ttl);
	}

	async #sendPasswordReset(account: User): Promise<void> {
		const ttl = this.env.AUTH_PASSWORD_RESET_TTL;
		const issued = await this.verificationTokens.issue(account, 'password_reset', ttl);

		await this.authMailer.sendPasswordReset(account, issued.token, ttl);
	}
}
