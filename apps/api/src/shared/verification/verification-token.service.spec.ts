import { beforeEach, describe, expect, it } from 'vitest';

import { hashToken } from '@vpn-poc/adapters';
import { FixedClock } from '@vpn/testing/fakes';

import { AppError } from '../errors/app-error.js';
import type {
	ConsumedToken,
	VerificationTokenRepository,
} from './verification-token.repository.js';
import type { VerificationPurpose } from './verification-token.purpose.js';
import { VerificationTokenService } from './verification-token.service.js';

interface IssuedRow {
	readonly accountId: string;
	readonly purpose: VerificationPurpose;
	readonly tokenHash: string;
	readonly expiresAt: Date;
}

class FakeRepository {
	readonly issued: IssuedRow[] = [];
	readonly invalidated: { accountId: string; purpose: VerificationPurpose; at: Date }[] = [];
	next: ConsumedToken | undefined = undefined;
	consumeCalls = 0;

	async invalidateOutstanding(
		accountId: string,
		purpose: VerificationPurpose,
		at: Date,
	): Promise<void> {
		this.invalidated.push({ accountId, purpose, at });
	}

	async issue(
		accountId: string,
		purpose: VerificationPurpose,
		tokenHash: string,
		expiresAt: Date,
	): Promise<void> {
		this.issued.push({ accountId, purpose, tokenHash, expiresAt });
	}

	async consume(): Promise<ConsumedToken | undefined> {
		this.consumeCalls += 1;
		return this.next;
	}
}

describe('VerificationTokenService', () => {
	let repository: FakeRepository;
	let clock: FixedClock;
	let service: VerificationTokenService;

	beforeEach(() => {
		repository = new FakeRepository();
		clock = new FixedClock(new Date('2026-05-01T00:00:00.000Z'));
		// The service depends on the repository's shape, not on drizzle.
		service = new VerificationTokenService(
			repository as unknown as VerificationTokenRepository,
			clock,
		);
	});

	it('invalidates the outstanding tokens before issuing a new one', async () => {
		await service.issue('acc-1', 'email_verification', 3600);

		expect(repository.invalidated).toEqual([
			{ accountId: 'acc-1', purpose: 'email_verification', at: clock.now() },
		]);
	});

	it('stores the hash and never the token itself', async () => {
		const issued = await service.issue('acc-1', 'email_verification', 3600);

		expect(repository.issued[0]?.tokenHash).toBe(hashToken(issued.token));
		expect(repository.issued[0]?.tokenHash).not.toBe(issued.token);
	});

	it('computes the expiry from the clock and the ttl', async () => {
		const issued = await service.issue('acc-1', 'password_reset', 3600);

		expect(issued.expiresAt).toEqual(new Date('2026-05-01T01:00:00.000Z'));
	});

	it('issues a different token every time', async () => {
		const first = await service.issue('acc-1', 'email_verification', 3600);
		const second = await service.issue('acc-1', 'email_verification', 3600);

		expect(first.token).not.toBe(second.token);
	});

	it('rejects a token the repository does not consume as TOKEN_INVALID', async () => {
		repository.next = undefined;

		try {
			await service.redeem('nope', 'email_verification');
			expect.unreachable('should have thrown');
		} catch (error) {
			expect((error as AppError).code).toBe('TOKEN_INVALID');
		}
	});

	it('rejects a consumed row whose expiry has passed as TOKEN_EXPIRED', async () => {
		repository.next = {
			accountId: 'acc-1',
			expiresAt: new Date('2026-04-30T23:59:59.000Z'),
		};

		try {
			await service.redeem('tok', 'email_verification');
			expect.unreachable('should have thrown');
		} catch (error) {
			expect((error as AppError).code).toBe('TOKEN_EXPIRED');
		}
	});

	it('treats an expiry exactly at now as expired', async () => {
		repository.next = { accountId: 'acc-1', expiresAt: clock.now() };

		await expect(service.redeem('tok', 'email_verification')).rejects.toBeInstanceOf(AppError);
	});

	it('returns the account id for a live token', async () => {
		repository.next = {
			accountId: 'acc-1',
			expiresAt: new Date('2026-05-01T00:00:01.000Z'),
		};

		expect(await service.redeem('tok', 'email_verification')).toBe('acc-1');
	});

	it('consumes the token before deciding it expired, so a stale token is spent', async () => {
		repository.next = { accountId: 'acc-1', expiresAt: new Date('2026-01-01T00:00:00.000Z') };

		await expect(service.redeem('tok', 'email_verification')).rejects.toBeInstanceOf(AppError);
		expect(repository.consumeCalls).toBe(1);
	});
});
