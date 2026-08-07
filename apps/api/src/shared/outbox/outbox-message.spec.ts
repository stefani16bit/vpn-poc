import { describe, expect, it } from 'vitest';

import { parseOutboxJob } from './outbox-message.js';

function job(name: string, message: unknown, accountId: unknown = 'acc-1') {
	return parseOutboxJob(name, { accountId, message });
}

describe('parseOutboxJob', () => {
	it('accepts an auth intent that names a person', () => {
		expect(job('auth.welcome', { userId: 'user-1' })).toEqual({
			accountId: 'acc-1',
			message: { kind: 'auth.welcome', userId: 'user-1' },
		});
	});

	it('accepts a billing intent that names a company', () => {
		expect(job('billing.payment_failed', { accountId: 'acc-1', externalEventId: 'evt-1' })).toEqual(
			{
				accountId: 'acc-1',
				message: {
					kind: 'billing.payment_failed',
					accountId: 'acc-1',
					externalEventId: 'evt-1',
				},
			},
		);
	});

	it('keeps the tenant beside the intent, never merged into it', () => {
		expect(job('auth.welcome', { userId: 'user-1' })?.message).not.toHaveProperty('accountId');
	});

	it('rejects a job with no tenant, because there is no scope to dispatch it under', () => {
		expect(parseOutboxJob('auth.welcome', { message: { userId: 'user-1' } })).toBeNull();
	});

	it('rejects an empty tenant, which set_config would accept and the policy would not', () => {
		expect(job('auth.welcome', { userId: 'user-1' }, '')).toBeNull();
	});

	it('rejects a tenant that is not a string', () => {
		expect(job('auth.welcome', { userId: 'user-1' }, 42)).toBeNull();
	});

	it('rejects an envelope that is not an object at all', () => {
		expect(parseOutboxJob('auth.welcome', null)).toBeNull();
		expect(parseOutboxJob('auth.welcome', 'acc-1')).toBeNull();
	});

	it('rejects an auth intent that carries an account instead of a user', () => {
		expect(job('auth.welcome', { accountId: 'acc-1' })).toBeNull();
	});

	it('rejects a billing intent that carries a user instead of an account', () => {
		expect(job('billing.payment_failed', { userId: 'user-1' })).toBeNull();
	});

	it('rejects a kind it does not know, so the job goes to the DLQ rather than vanishing', () => {
		expect(job('auth.telepathy', { userId: 'user-1' })).toBeNull();
	});

	it('rejects an empty recipient, which would otherwise look like a valid lookup', () => {
		expect(job('auth.welcome', { userId: '' })).toBeNull();
	});

	it('rejects a recipient that is not a string', () => {
		expect(job('auth.welcome', { userId: 42 })).toBeNull();
	});

	it('rejects an intent that is not an object at all', () => {
		expect(job('auth.welcome', null)).toBeNull();
		expect(job('auth.welcome', 'user-1')).toBeNull();
	});

	it('carries the extra fields a kind declares', () => {
		expect(
			job('auth.password_changed', {
				userId: 'user-1',
				changedAt: '2026-05-01T00:00:00.000Z',
			})?.message,
		).toMatchObject({ changedAt: '2026-05-01T00:00:00.000Z' });
	});
});
