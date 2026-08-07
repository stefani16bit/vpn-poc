import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';
import { getTranslator } from '@vpn/i18n';
import { EMAIL_SENDER, type Account, type IEmailSender } from '@vpn/ports';

import { localeOf } from '../locale/account-locale.js';

@Injectable()
export class BillingMailer {
	constructor(
		@Inject(EMAIL_SENDER) private readonly email: IEmailSender,
		@Inject(ENV) private readonly env: Env,
	) {}

	async sendPaymentFailed(account: Account, externalEventId: string): Promise<void> {
		await this.email.send({
			to: account.email,
			template: 'payment_failed',
			locale: localeOf(account),
			variables: { url: `${this.env.WEB_ORIGIN}/billing` },
			idempotencyKey: `payment-failed:${externalEventId}`,
		});
	}

	async sendSubscriptionCanceled(
		account: Account,
		endsAt: Date | null,
		externalEventId: string,
	): Promise<void> {
		const locale = localeOf(account);

		await this.email.send({
			to: account.email,
			template: 'subscription_canceled',
			locale,
			variables: {
				endsAt: endsAt?.toISOString() ?? getTranslator(locale)('billing.periodEndUnknown'),
			},
			idempotencyKey: `subscription-canceled:${externalEventId}`,
		});
	}
}
