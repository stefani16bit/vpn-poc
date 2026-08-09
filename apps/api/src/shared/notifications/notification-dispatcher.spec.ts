import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '@vpn-poc/env';

import type { UserRepository } from '../identity/repositories/user.repository.js';
import type { User } from '../identity/user.js';
import type { VerificationTokenService } from '../verification/verification-token.service.js';
import type { AuthMailer } from './auth-mailer.service.js';
import type { BillingMailer } from './billing-mailer.service.js';
import { NotificationDispatcher } from './notification-dispatcher.js';

type Mock = ReturnType<typeof vi.fn>;

const env = {
	AUTH_EMAIL_VERIFICATION_TTL: 86400,
	AUTH_PASSWORD_RESET_TTL: 3600,
} as Env;

function account(overrides: Partial<User> = {}): User {
	return {
		id: 'acc-1',
		email: 'ada@example.com',
		locale: 'pt-BR',
		emailVerifiedAt: null,
		createdAt: new Date('2026-01-01T00:00:00.000Z'),
		...overrides,
	} as User;
}

describe('NotificationDispatcher', () => {
	let identity: { findById: Mock; findOwner: Mock };
	let authMailer: Record<string, Mock>;
	let billingMailer: Record<string, Mock>;
	let verificationTokens: { issue: Mock };
	let dispatcher: NotificationDispatcher;

	beforeEach(() => {
		identity = {
			findById: vi.fn().mockResolvedValue(account()),
			findOwner: vi.fn().mockResolvedValue(account()),
		};
		authMailer = {
			sendVerification: vi.fn().mockResolvedValue(undefined),
			sendPasswordReset: vi.fn().mockResolvedValue(undefined),
			sendWelcome: vi.fn().mockResolvedValue(undefined),
			sendPasswordChanged: vi.fn().mockResolvedValue(undefined),
		};
		billingMailer = {
			sendPaymentFailed: vi.fn().mockResolvedValue(undefined),
			sendSubscriptionActivated: vi.fn().mockResolvedValue(undefined),
			sendCancellationScheduled: vi.fn().mockResolvedValue(undefined),
			sendSubscriptionResumed: vi.fn().mockResolvedValue(undefined),
			sendSubscriptionCanceled: vi.fn().mockResolvedValue(undefined),
			sendAccessRevoked: vi.fn().mockResolvedValue(undefined),
		};
		verificationTokens = {
			issue: vi.fn().mockResolvedValue({ token: 'tok-1', expiresAt: new Date() }),
		};

		dispatcher = new NotificationDispatcher(
			identity as unknown as UserRepository,
			env,
			authMailer as unknown as AuthMailer,
			billingMailer as unknown as BillingMailer,
			verificationTokens as unknown as VerificationTokenService,
		);
	});

	it('issues the verification token here, not where the request was served', async () => {
		await dispatcher.send({ kind: 'auth.verification', userId: 'acc-1' });

		expect(verificationTokens.issue).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'acc-1' }),
			'email_verification',
			86400,
		);
		expect(authMailer['sendVerification']).toHaveBeenCalledWith(expect.anything(), 'tok-1', 86400);
	});

	it('issues no verification for an account that verified in the meantime', async () => {
		identity.findById.mockResolvedValue(account({ emailVerifiedAt: new Date() }));

		await dispatcher.send({ kind: 'auth.verification', userId: 'acc-1' });

		expect(verificationTokens.issue).not.toHaveBeenCalled();
		expect(authMailer['sendVerification']).not.toHaveBeenCalled();
	});

	it('issues the reset token on the reset ttl', async () => {
		await dispatcher.send({ kind: 'auth.password_reset', userId: 'acc-1' });

		expect(verificationTokens.issue).toHaveBeenCalledWith(
			expect.objectContaining({ id: 'acc-1' }),
			'password_reset',
			3600,
		);
	});

	it('sends nothing for an account that no longer exists', async () => {
		identity.findById.mockResolvedValue(null);

		await dispatcher.send({ kind: 'auth.welcome', userId: 'acc-1' });

		expect(authMailer['sendWelcome']).not.toHaveBeenCalled();
	});

	it('revives the change instant that crossed the queue as a string', async () => {
		await dispatcher.send({
			kind: 'auth.password_changed',
			userId: 'user-1',
			changedAt: '2026-05-01T00:00:00.000Z',
		});

		expect(authMailer['sendPasswordChanged']).toHaveBeenCalledWith(
			expect.anything(),
			new Date('2026-05-01T00:00:00.000Z'),
		);
	});

	it('revives a null period end as null rather than as an epoch date', async () => {
		await dispatcher.send({
			kind: 'billing.cancellation_scheduled',
			accountId: 'acc-1',
			requestedAt: '2026-05-01T00:00:00.000Z',
			endsAt: null,
		});

		expect(billingMailer['sendCancellationScheduled']).toHaveBeenCalledWith(
			expect.anything(),
			null,
			new Date('2026-05-01T00:00:00.000Z'),
		);
	});

	it('revives both instants a scheduled cancellation crossed the queue with', async () => {
		await dispatcher.send({
			kind: 'billing.cancellation_scheduled',
			accountId: 'acc-1',
			requestedAt: '2026-05-01T00:00:00.000Z',
			endsAt: '2026-09-01T00:00:00.000Z',
		});

		expect(billingMailer['sendCancellationScheduled']).toHaveBeenCalledWith(
			expect.anything(),
			new Date('2026-09-01T00:00:00.000Z'),
			new Date('2026-05-01T00:00:00.000Z'),
		);
	});

	it('revives the instant a resume was asked for', async () => {
		await dispatcher.send({
			kind: 'billing.subscription_resumed',
			accountId: 'acc-1',
			requestedAt: '2026-05-01T00:00:00.000Z',
		});

		expect(billingMailer['sendSubscriptionResumed']).toHaveBeenCalledWith(
			expect.anything(),
			new Date('2026-05-01T00:00:00.000Z'),
		);
	});

	it('mails the owner when the account loses its tier', async () => {
		await dispatcher.send({
			kind: 'billing.access_revoked',
			accountId: 'acc-4',
			externalEventId: 'evt-4',
		});

		expect(identity.findOwner).toHaveBeenCalledWith('acc-4');
		expect(billingMailer['sendAccessRevoked']).toHaveBeenCalledWith(expect.anything(), 'evt-4');
	});

	it('carries the provider event id through, so the mailer stays idempotent', async () => {
		await dispatcher.send({
			kind: 'billing.payment_failed',
			accountId: 'acc-1',
			externalEventId: 'evt-2',
		});

		expect(billingMailer['sendPaymentFailed']).toHaveBeenCalledWith(expect.anything(), 'evt-2');
	});

	it('mails the activation to the owner, carrying the event id the mailer keys on', async () => {
		await dispatcher.send({
			kind: 'billing.subscription_activated',
			accountId: 'acc-3',
			externalEventId: 'evt-3',
		});

		expect(identity.findOwner).toHaveBeenCalledWith('acc-3');
		expect(billingMailer['sendSubscriptionActivated']).toHaveBeenCalledWith(
			expect.anything(),
			'evt-3',
		);
	});

	it('resolves an auth intent to the person it names', async () => {
		await dispatcher.send({ kind: 'auth.welcome', userId: 'user-7' });

		expect(identity.findById).toHaveBeenCalledWith('user-7');
		expect(identity.findOwner).not.toHaveBeenCalled();
	});

	it('resolves a billing intent to the account owner, since the company has no inbox', async () => {
		await dispatcher.send({
			kind: 'billing.payment_failed',
			accountId: 'acc-9',
			externalEventId: 'evt-9',
		});

		expect(identity.findOwner).toHaveBeenCalledWith('acc-9');
		expect(identity.findById).not.toHaveBeenCalled();
	});

	it('stays silent when the account has no owner to write to', async () => {
		identity.findOwner.mockResolvedValue(undefined);

		await dispatcher.send({
			kind: 'billing.payment_failed',
			accountId: 'acc-9',
			externalEventId: 'evt-9',
		});

		expect(billingMailer['sendPaymentFailed']).not.toHaveBeenCalled();
	});
});
