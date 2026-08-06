import { Inject, Injectable } from '@nestjs/common';

import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';
import { EMAIL_SENDER, type Account, type IEmailSender } from '@vpn/ports';

import { localeOf } from '../../../shared/locale/account-locale.js';

const IDEMPOTENCY_TOKEN_LENGTH = 16;

@Injectable()
export class AuthMailer {
	constructor(
		@Inject(EMAIL_SENDER) private readonly email: IEmailSender,
		@Inject(ENV) private readonly env: Env,
	) {}

	async sendVerification(account: Account, token: string, ttlSeconds: number): Promise<void> {
		await this.email.send({
			to: account.email,
			template: 'verify_email',
			locale: localeOf(account),
			variables: {
				url: `${this.env.WEB_ORIGIN}/verify-email?token=${token}`,
				expiresInHours: hoursFrom(ttlSeconds),
			},
			idempotencyKey: `verify:${token.slice(0, IDEMPOTENCY_TOKEN_LENGTH)}`,
		});
	}

	async sendPasswordReset(account: Account, token: string, ttlSeconds: number): Promise<void> {
		await this.email.send({
			to: account.email,
			template: 'reset_password',
			locale: localeOf(account),
			variables: {
				url: `${this.env.WEB_ORIGIN}/reset-password?token=${token}`,
				expiresInHours: hoursFrom(ttlSeconds),
			},
			idempotencyKey: `reset:${token.slice(0, IDEMPOTENCY_TOKEN_LENGTH)}`,
		});
	}

	async sendWelcome(account: Account): Promise<void> {
		await this.email.send({
			to: account.email,
			template: 'welcome',
			locale: localeOf(account),
			variables: {},
			idempotencyKey: `welcome:${account.id}`,
		});
	}

	async sendPasswordChanged(account: Account, at: Date): Promise<void> {
		await this.email.send({
			to: account.email,
			template: 'password_changed',
			locale: localeOf(account),
			variables: {},
			idempotencyKey: `password-changed:${account.id}:${Math.floor(at.getTime() / 1000)}`,
		});
	}
}

function hoursFrom(ttlSeconds: number): string {
	return String(Math.max(1, Math.round(ttlSeconds / 3600)));
}
