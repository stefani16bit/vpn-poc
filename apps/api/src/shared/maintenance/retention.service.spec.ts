import { describe, expect, it, vi } from 'vitest';

import { FixedClock, MemoryCacheStore } from '@vpn/testing/fakes';

import type { TransactionRunner } from '../database/transaction-runner.js';
import type { RetentionRepository } from './retention.repository.js';
import { RetentionSweeper } from './retention.service.js';

const NOW = new Date('2026-01-02T00:00:00.000Z');
const A_DAY_EARLIER = new Date('2026-01-01T00:00:00.000Z');

function sweeper(counts = { verification: 2, refresh: 3, outbox: 4 }) {
	const clock = new FixedClock(NOW);
	const cache = new MemoryCacheStore(clock);

	const purgeVerificationTokens = vi.fn(() => Promise.resolve(counts.verification));
	const purgeRefreshTokens = vi.fn(() => Promise.resolve(counts.refresh));
	const purgeOutbox = vi.fn(() => Promise.resolve(counts.outbox));

	const retention = {
		purgeVerificationTokens,
		purgeRefreshTokens,
		purgeOutbox,
	} as unknown as RetentionRepository;

	const runAsSystem = vi.fn(<T>(work: (executor: unknown) => Promise<T>) =>
		work(Symbol('executor')),
	);
	const transactions = { runAsSystem } as unknown as TransactionRunner;

	const subject = new RetentionSweeper(retention, transactions, cache, clock);
	const twin = new RetentionSweeper(retention, transactions, cache, clock);

	return {
		subject,
		twin,
		clock,
		runAsSystem,
		purgeVerificationTokens,
		purgeRefreshTokens,
		purgeOutbox,
	};
}

describe('RetentionSweeper', () => {
	it('reports what each table gave up', async () => {
		const { subject } = sweeper();

		expect(await subject.runOnce()).toEqual({
			verificationTokens: 2,
			refreshTokens: 3,
			outbox: 4,
		});
	});

	// A row that died a minute ago is still what an incident opened this morning
	// needs to read.
	it('leaves a day of grace behind the cutoff', async () => {
		const { subject, purgeRefreshTokens, purgeOutbox, purgeVerificationTokens } = sweeper();

		await subject.runOnce();

		for (const purge of [purgeRefreshTokens, purgeOutbox, purgeVerificationTokens]) {
			expect(purge).toHaveBeenCalledWith(A_DAY_EARLIER, expect.anything());
		}
	});

	// These rows belong to every account at once, and a tenant-scoped sweep would
	// see only the one it happened to pick.
	it('sweeps as system, because the rows are nobody tenant in particular', async () => {
		const { subject, runAsSystem } = sweeper();

		await subject.runOnce();

		expect(runAsSystem).toHaveBeenCalledTimes(1);
	});

	it('lets one of two workers sweep, not both', async () => {
		const { subject, twin } = sweeper();

		expect(await subject.runIfDue()).not.toBeNull();
		expect(await twin.runIfDue()).toBeNull();
	});

	it('sweeps again once the hour has passed', async () => {
		const { subject, clock } = sweeper();
		await subject.runIfDue();

		clock.advance(3601);

		expect(await subject.runIfDue()).not.toBeNull();
	});
});
