import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '@vpn-poc/env';
import type { Account, IIdentityProvider } from '@vpn/ports';

import type { VerificationTokenService } from '../verification/verification-token.service.js';
import type { AuthMailer } from './auth-mailer.service.js';
import type { BillingMailer } from './billing-mailer.service.js';
import { NotificationDispatcher } from './notification-dispatcher.js';

type Mock = ReturnType<typeof vi.fn>;

const env = {
	AUTH_EMAIL_VERIFICATION_TTL: 86400,
	AUTH_PASSWORD_RESET_TTL: 3600,
} as Env;

function account(overrides: Partial<Account> = {}): Account {
	return {
		id: 'acc-1',
		email: 'ada@example.com',
		locale: 'pt-BR',
		emailVerifiedAt: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	} as Account;
}

describe('NotificationDispatcher', () => {
	let identity: { findById: Mock };
	let authMailer: Record<string, Mock>;
	let billingMailer: Record<string, Mock>;
	let verificationTokens: { issue: Mock };
	let dispatcher: NotificationDispatcher;

	beforeEach(() => {
		identity = { findById: vi.fn().mockResolvedValue(account()) };
		authMailer = {
			sendVerification: vi.fn().mockResolvedValue(undefined),
			sendPasswordReset: vi.fn().mockResolvedValue(undefined),
			sendWelcome: vi.fn().mockResolvedValue(undefined),
			sendPasswordChanged: vi.fn().mockResolvedValue(undefined),
		};
		billingMailer = {
			sendPaymentFailed: vi.fn().mockResolvedValue(undefined),
			sendSubscriptionCanceled: vi.fn().mockResolvedValue(undefined),
		};
		verificationTokens = {
			issue: vi.fn().mockResolvedValue({ token: 'tok-1', expiresAt: new Date() }),
		};

		dispatcher = new NotificationDispatcher(
			identity as unknown as IIdentityProvider,
			env,
			authMailer as unknown as AuthMailer,
			billingMailer as unknown as BillingMailer,
			verificationTokens as unknown as VerificationTokenService,
		);
	});

	it('issues the verification token here, not where the request was served', async () => {
		await dispatcher.send({ kind: 'auth.verification', accountId: 'acc-1' });

		expect(verificationTokens.issue).toHaveBeenCalledWith('acc-1', 'email_verification', 86400);
		expect(authMailer['sendVerification']).toHaveBeenCalledWith(expect.anything(), 'tok-1', 86400);
	});

	it('issues no verification for an account that verified in the meantime', async () => {
		identity.findById.mockResolvedValue(account({ emailVerifiedAt: new Date() }));

		await dispatcher.send({ kind: 'auth.verification', accountId: 'acc-1' });

		expect(verificationTokens.issue).not.toHaveBeenCalled();
		expect(authMailer['sendVerification']).not.toHaveBeenCalled();
	});

	it('issues the reset token on the reset ttl', async () => {
		await dispatcher.send({ kind: 'auth.password_reset', accountId: 'acc-1' });

		expect(verificationTokens.issue).toHaveBeenCalledWith('acc-1', 'password_reset', 3600);
	});

	it('sends nothing for an account that no longer exists', async () => {
		identity.findById.mockResolvedValue(null);

		await dispatcher.send({ kind: 'auth.welcome', accountId: 'acc-1' });

		expect(authMailer['sendWelcome']).not.toHaveBeenCalled();
	});

	it('revives the change instant that crossed the queue as a string', async () => {
		await dispatcher.send({
			kind: 'auth.password_changed',
			accountId: 'acc-1',
			changedAt: '2026-05-01T00:00:00.000Z',
		});

		expect(authMailer['sendPasswordChanged']).toHaveBeenCalledWith(
			expect.anything(),
			new Date('2026-05-01T00:00:00.000Z'),
		);
	});

	it('revives a null period end as null rather than as an epoch date', async () => {
		await dispatcher.send({
			kind: 'billing.subscription_canceled',
			accountId: 'acc-1',
			externalEventId: 'evt-1',
			endsAt: null,
		});

		expect(billingMailer['sendSubscriptionCanceled']).toHaveBeenCalledWith(
			expect.anything(),
			null,
			'evt-1',
		);
	});

	it('carries the provider event id through, so the mailer stays idempotent', async () => {
		await dispatcher.send({
			kind: 'billing.payment_failed',
			accountId: 'acc-1',
			externalEventId: 'evt-2',
		});

		expect(billingMailer['sendPaymentFailed']).toHaveBeenCalledWith(expect.anything(), 'evt-2');
	});
});
