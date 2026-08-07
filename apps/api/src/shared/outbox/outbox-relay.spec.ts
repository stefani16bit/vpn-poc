import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IJobQueue } from '@vpn/ports';

import type { TransactionRunner } from '../database/transaction-runner.js';
import { OutboxRelay } from './outbox-relay.js';
import type { OutboxRepository } from './outbox.repository.js';

type Mock = ReturnType<typeof vi.fn>;

const EXECUTOR = Symbol('executor');

describe('OutboxRelay', () => {
	let outbox: { claimPending: Mock; markPublished: Mock };
	let queue: { enqueue: Mock };
	let relay: OutboxRelay;

	beforeEach(() => {
		outbox = {
			claimPending: vi.fn().mockResolvedValue([]),
			markPublished: vi.fn().mockResolvedValue(undefined),
		};
		queue = { enqueue: vi.fn().mockResolvedValue(undefined) };

		relay = new OutboxRelay(
			queue as unknown as IJobQueue,
			outbox as unknown as OutboxRepository,
			{
				run: vi.fn((work: (executor: unknown) => Promise<unknown>) => work(EXECUTOR)),
			} as unknown as TransactionRunner,
		);
	});

	it('reports nothing done when the outbox is empty', async () => {
		expect(await relay.runOnce()).toBe(0);
		expect(queue.enqueue).not.toHaveBeenCalled();
	});

	it('enqueues each pending entry and marks it', async () => {
		outbox.claimPending.mockResolvedValue([
			{ id: 'row-1', job: { name: 'auth.welcome', data: { accountId: 'acc-1' } } },
			{ id: 'row-2', job: { name: 'auth.verification', data: { accountId: 'acc-2' } } },
		]);

		expect(await relay.runOnce()).toBe(2);
		expect(queue.enqueue).toHaveBeenCalledWith({
			name: 'auth.welcome',
			data: { accountId: 'acc-1' },
		});
		expect(outbox.markPublished).toHaveBeenCalledWith('row-2', EXECUTOR);
	});

	it('enqueues before marking, so a crash between the two redelivers', async () => {
		outbox.claimPending.mockResolvedValue([{ id: 'row-1', job: { name: 'a', data: {} } }]);

		await relay.runOnce();

		expect(queue.enqueue.mock.invocationCallOrder[0]).toBeLessThan(
			outbox.markPublished.mock.invocationCallOrder[0] as number,
		);
	});

	it('claims and marks through the same executor, so the batch is one transaction', async () => {
		outbox.claimPending.mockResolvedValue([{ id: 'row-1', job: { name: 'a', data: {} } }]);

		await relay.runOnce(7);

		expect(outbox.claimPending).toHaveBeenCalledWith(7, EXECUTOR);
	});
});
