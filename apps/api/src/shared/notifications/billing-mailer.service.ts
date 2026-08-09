import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';
import { getTranslator } from '@vpn/i18n';
import { EMAIL_SENDER, type IEmailSender } from '@vpn/ports';
import type { User } from '../identity/user.js';

import { localeOf } from '../locale/user-locale.js';

@Injectable()
export class BillingMailer {
	constructor(
		@Inject(EMAIL_SENDER) private readonly email: IEmailSender,
		@Inject(ENV) private readonly env: Env,
	) {}

	async sendPaymentFailed(account: User, externalEventId: string): Promise<void> {
		await this.email.send({
			to: account.email,
			template: 'payment_failed',
			locale: localeOf(account),
			variables: { url: `${this.env.WEB_ORIGIN}/billing` },
			idempotencyKey: `payment-failed:${externalEventId}`,
		});
	}

	async sendSubscriptionActivated(account: User, externalEventId: string): Promise<void> {
		await this.email.send({
			to: account.email,
			template: 'subscription_activated',
			locale: localeOf(account),
			variables: { url: `${this.env.WEB_ORIGIN}/billing` },
			idempotencyKey: `subscription-activated:${externalEventId}`,
		});
	}

	async sendCancellationScheduled(
		account: User,
		endsAt: Date | null,
		requestedAt: Date,
	): Promise<void> {
		const locale = localeOf(account);

		await this.email.send({
			to: account.email,
			template: 'subscription_cancel_scheduled',
			locale,
			variables: {
				endsAt: endsAt?.toISOString() ?? getTranslator(locale)('billing.periodEndUnknown'),
				url: `${this.env.WEB_ORIGIN}/billing`,
			},
			idempotencyKey: `cancel-scheduled:${account.accountId}:${secondsOf(requestedAt)}`,
		});
	}

	async sendSubscriptionResumed(account: User, requestedAt: Date): Promise<void> {
		await this.email.send({
			to: account.email,
			template: 'subscription_resumed',
			locale: localeOf(account),
			variables: { url: `${this.env.WEB_ORIGIN}/billing` },
			idempotencyKey: `subscription-resumed:${account.accountId}:${secondsOf(requestedAt)}`,
		});
	}

	async sendSubscriptionCanceled(account: User, externalEventId: string): Promise<void> {
		await this.email.send({
			to: account.email,
			template: 'subscription_canceled',
			locale: localeOf(account),
			variables: { url: `${this.env.WEB_ORIGIN}/billing` },
			idempotencyKey: `subscription-canceled:${externalEventId}`,
		});
	}

	async sendAccessRevoked(account: User, externalEventId: string): Promise<void> {
		await this.email.send({
			to: account.email,
			template: 'access_revoked',
			locale: localeOf(account),
			variables: { url: `${this.env.WEB_ORIGIN}/billing` },
			idempotencyKey: `access-revoked:${externalEventId}`,
		});
	}
}

function secondsOf(instant: Date): number {
	return Math.floor(instant.getTime() / 1000);
}
