import { describe, expect, it } from 'vitest';

import { parseOutboxMessage } from './outbox-message.js';

describe('parseOutboxMessage', () => {
	it('accepts an auth intent that names a person', () => {
		expect(parseOutboxMessage('auth.welcome', { userId: 'user-1' })).toEqual({
			kind: 'auth.welcome',
			userId: 'user-1',
		});
	});

	it('accepts a billing intent that names a company', () => {
		expect(
			parseOutboxMessage('billing.payment_failed', {
				accountId: 'acc-1',
				externalEventId: 'evt-1',
			}),
		).toEqual({
			kind: 'billing.payment_failed',
			accountId: 'acc-1',
			externalEventId: 'evt-1',
		});
	});

	it('rejects an auth intent that carries an account instead of a user', () => {
		expect(parseOutboxMessage('auth.welcome', { accountId: 'acc-1' })).toBeNull();
	});

	it('rejects a billing intent that carries a user instead of an account', () => {
		expect(parseOutboxMessage('billing.payment_failed', { userId: 'user-1' })).toBeNull();
	});

	it('rejects a kind it does not know, so the job goes to the DLQ rather than vanishing', () => {
		expect(parseOutboxMessage('auth.telepathy', { userId: 'user-1' })).toBeNull();
	});

	it('rejects an empty recipient, which would otherwise look like a valid lookup', () => {
		expect(parseOutboxMessage('auth.welcome', { userId: '' })).toBeNull();
	});

	it('rejects a recipient that is not a string', () => {
		expect(parseOutboxMessage('auth.welcome', { userId: 42 })).toBeNull();
	});

	it('rejects a payload that is not an object at all', () => {
		expect(parseOutboxMessage('auth.welcome', null)).toBeNull();
		expect(parseOutboxMessage('auth.welcome', 'user-1')).toBeNull();
	});

	it('carries the extra fields a kind declares', () => {
		expect(
			parseOutboxMessage('auth.password_changed', {
				userId: 'user-1',
				changedAt: '2026-05-01T00:00:00.000Z',
			}),
		).toMatchObject({ changedAt: '2026-05-01T00:00:00.000Z' });
	});
});
