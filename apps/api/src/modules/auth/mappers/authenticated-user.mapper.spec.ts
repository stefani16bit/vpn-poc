import { describe, expect, it } from 'vitest';

import type { Account } from '@vpn/ports';

import { toAuthenticatedUser } from './authenticated-user.mapper.js';

function account(overrides: Partial<Account> = {}): Account {
	return {
		id: 'acc-1',
		email: 'ada@example.com',
		locale: 'pt-BR',
		emailVerifiedAt: null,
		createdAt: new Date('2026-03-04T05:06:07.000Z'),
		...overrides,
	} as Account;
}

describe('toAuthenticatedUser', () => {
	it('reports an account with no verification timestamp as unverified', () => {
		expect(toAuthenticatedUser(account()).emailVerified).toBe(false);
	});

	it('reports an account with a verification timestamp as verified', () => {
		const mapped = toAuthenticatedUser(account({ emailVerifiedAt: new Date() }));
		expect(mapped.emailVerified).toBe(true);
	});

	it('sends createdAt over the wire as an ISO string', () => {
		expect(toAuthenticatedUser(account()).createdAt).toBe('2026-03-04T05:06:07.000Z');
	});

	it('resolves the locale rather than passing an unsupported one through', () => {
		expect(toAuthenticatedUser(account({ locale: 'kl-GL' })).locale).not.toBe('kl-GL');
	});

	it('carries id and email unchanged', () => {
		const mapped = toAuthenticatedUser(account());
		expect(mapped).toMatchObject({ id: 'acc-1', email: 'ada@example.com' });
	});
});
