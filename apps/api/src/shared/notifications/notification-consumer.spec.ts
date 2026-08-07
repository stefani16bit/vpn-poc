import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FixedClock, MemoryJobQueue } from '@vpn/testing/fakes';

import { NotificationConsumer } from './notification-consumer.js';
import type { NotificationDispatcher } from './notification-dispatcher.js';

type Mock = ReturnType<typeof vi.fn>;

describe('NotificationConsumer', () => {
	let queue: MemoryJobQueue;
	let dispatcher: { send: Mock };
	let consumer: NotificationConsumer;

	beforeEach(() => {
		queue = new MemoryJobQueue(new FixedClock());
		dispatcher = { send: vi.fn().mockResolvedValue(undefined) };
		consumer = new NotificationConsumer(queue, dispatcher as unknown as NotificationDispatcher);
	});

	it('sends and then acknowledges, so a crash before the send redelivers', async () => {
		await queue.enqueue({ name: 'auth.welcome', data: { accountId: 'acc-1' } });

		expect((await consumer.runOnce()).received).toBe(1);
		expect(dispatcher.send).toHaveBeenCalledWith({ kind: 'auth.welcome', accountId: 'acc-1' });

		queue.makeEverythingVisible();
		expect(await queue.receive()).toEqual([]);
	});

	it('leaves an unrecognised job on the queue instead of dropping it', async () => {
		await queue.enqueue({ name: 'auth.telepathy', data: { accountId: 'acc-1' } });

		expect((await consumer.runOnce()).unknown).toEqual(['auth.telepathy']);

		queue.makeEverythingVisible();
		expect(await queue.receive()).toHaveLength(1);
	});

	it('leaves a job whose data carries no account on the queue', async () => {
		await queue.enqueue({ name: 'auth.welcome', data: { nothing: true } });

		expect((await consumer.runOnce()).unknown).toEqual(['auth.welcome']);
	});

	it('does not acknowledge a job whose send failed, so it is retried', async () => {
		dispatcher.send.mockRejectedValue(new Error('smtp is down'));
		await queue.enqueue({ name: 'auth.welcome', data: { accountId: 'acc-1' } });

		expect((await consumer.runOnce()).failed).toHaveLength(1);

		queue.makeEverythingVisible();
		expect(await queue.receive()).toHaveLength(1);
	});

	it('keeps going after one job fails, so a poisoned entry does not stall the batch', async () => {
		dispatcher.send.mockRejectedValueOnce(new Error('smtp is down'));
		await queue.enqueue({ name: 'auth.welcome', data: { accountId: 'acc-1' } });
		await queue.enqueue({ name: 'auth.password_reset', data: { accountId: 'acc-2' } });

		const report = await consumer.runOnce();

		expect(report.received).toBe(2);
		expect(report.failed).toHaveLength(1);
		expect(dispatcher.send).toHaveBeenCalledTimes(2);
	});
});
