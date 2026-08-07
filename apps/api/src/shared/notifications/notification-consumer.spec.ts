import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock, MemoryJobQueue } from '@vpn/testing/fakes';

import type { TransactionRunner } from '../database/transaction-runner.js';
import { NotificationConsumer } from './notification-consumer.js';
import type { NotificationDispatcher } from './notification-dispatcher.js';

type Mock = ReturnType<typeof vi.fn>;

function envelope(accountId: string, message: Record<string, unknown>) {
	return { accountId, message };
}

describe('NotificationConsumer', () => {
	let queue: MemoryJobQueue;
	let dispatcher: { send: Mock };
	let transactions: { runAsSystem: Mock; runInAccount: Mock };
	let consumer: NotificationConsumer;

	beforeEach(() => {
		queue = new MemoryJobQueue(new FixedClock());
		dispatcher = { send: vi.fn().mockResolvedValue(undefined) };
		transactions = {
			runAsSystem: vi.fn((work: () => Promise<unknown>) => work()),
			runInAccount: vi.fn((_accountId: string, work: () => Promise<unknown>) => work()),
		};
		consumer = new NotificationConsumer(
			queue,
			dispatcher as unknown as NotificationDispatcher,
			transactions as unknown as TransactionRunner,
		);
	});

	it('sends and then acknowledges, so a crash before the send redelivers', async () => {
		await queue.enqueue({ name: 'auth.welcome', data: envelope('acc-1', { userId: 'user-1' }) });

		expect((await consumer.runOnce()).received).toBe(1);
		expect(dispatcher.send).toHaveBeenCalledWith({ kind: 'auth.welcome', userId: 'user-1' });

		queue.makeEverythingVisible();
		expect(await queue.receive()).toEqual([]);
	});

	it('dispatches under the account the outbox row belonged to, never as the system', async () => {
		await queue.enqueue({ name: 'auth.welcome', data: envelope('acc-1', { userId: 'user-1' }) });

		await consumer.runOnce();

		expect(transactions.runInAccount.mock.calls[0]?.[0]).toBe('acc-1');
		expect(transactions.runAsSystem).not.toHaveBeenCalled();
	});

	it('opens one transaction per message, so one account cannot read for another', async () => {
		await queue.enqueue({ name: 'auth.welcome', data: envelope('acc-1', { userId: 'user-1' }) });
		await queue.enqueue({
			name: 'auth.password_reset',
			data: envelope('acc-2', { userId: 'user-2' }),
		});

		await consumer.runOnce();

		expect(transactions.runInAccount.mock.calls.map((call) => call[0])).toEqual(['acc-1', 'acc-2']);
	});

	it('leaves a job with no account on the queue, since there is no scope to open', async () => {
		await queue.enqueue({ name: 'auth.welcome', data: { message: { userId: 'user-1' } } });

		expect((await consumer.runOnce()).unknown).toEqual(['auth.welcome']);
		expect(transactions.runInAccount).not.toHaveBeenCalled();

		queue.makeEverythingVisible();
		expect(await queue.receive()).toHaveLength(1);
	});

	it('leaves an unrecognised job on the queue instead of dropping it', async () => {
		await queue.enqueue({ name: 'auth.telepathy', data: envelope('acc-1', { userId: 'user-1' }) });

		expect((await consumer.runOnce()).unknown).toEqual(['auth.telepathy']);

		queue.makeEverythingVisible();
		expect(await queue.receive()).toHaveLength(1);
	});

	it('leaves a job whose data names no recipient on the queue', async () => {
		await queue.enqueue({ name: 'auth.welcome', data: envelope('acc-1', { nothing: true }) });

		expect((await consumer.runOnce()).unknown).toEqual(['auth.welcome']);
	});

	it('does not acknowledge a job whose send failed, so it is retried', async () => {
		dispatcher.send.mockRejectedValue(new Error('smtp is down'));
		await queue.enqueue({ name: 'auth.welcome', data: envelope('acc-1', { userId: 'user-1' }) });

		expect((await consumer.runOnce()).failed).toHaveLength(1);

		queue.makeEverythingVisible();
		expect(await queue.receive()).toHaveLength(1);
	});

	it('keeps going after one job fails, so a poisoned entry does not stall the batch', async () => {
		dispatcher.send.mockRejectedValueOnce(new Error('smtp is down'));
		await queue.enqueue({ name: 'auth.welcome', data: envelope('acc-1', { userId: 'user-1' }) });
		await queue.enqueue({
			name: 'auth.password_reset',
			data: envelope('acc-2', { userId: 'user-2' }),
		});

		const report = await consumer.runOnce();

		expect(report.received).toBe(2);
		expect(report.failed).toHaveLength(1);
		expect(dispatcher.send).toHaveBeenCalledTimes(2);
	});
});
