import { Inject, Injectable } from '@nestjs/common';

import { JOB_QUEUE, type IJobQueue } from '@vpn/ports';

import { TransactionRunner } from '../database/transaction-runner.js';
import { OutboxRepository } from './outbox.repository.js';

const DEFAULT_BATCH = 20;

@Injectable()
export class OutboxRelay {
	constructor(
		@Inject(JOB_QUEUE) private readonly queue: IJobQueue,
		private readonly outbox: OutboxRepository,
		private readonly transactions: TransactionRunner,
	) {}

	async runOnce(batchSize = DEFAULT_BATCH): Promise<number> {
		return this.transactions.run(async (executor) => {
			const pending = await this.outbox.claimPending(batchSize, executor);

			for (const entry of pending) {
				await this.queue.enqueue(entry.job);
				await this.outbox.markPublished(entry.id, executor);
			}

			return pending.length;
		});
	}
}
