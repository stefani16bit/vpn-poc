import { Inject, Injectable } from '@nestjs/common';

import { JOB_QUEUE, type IJobQueue } from '@vpn/ports';

import { TransactionRunner } from '../database/transaction-runner.js';
import { parseOutboxJob } from '../outbox/outbox-message.js';
import { NotificationDispatcher } from './notification-dispatcher.js';

export interface ConsumerReport {
	readonly received: number;
	readonly unknown: readonly string[];
	readonly failed: readonly { name: string; error: unknown }[];
}

@Injectable()
export class NotificationConsumer {
	constructor(
		@Inject(JOB_QUEUE) private readonly queue: IJobQueue,
		private readonly dispatcher: NotificationDispatcher,
		private readonly transactions: TransactionRunner,
	) {}

	async runOnce(waitSeconds = 0): Promise<ConsumerReport> {
		const received = await this.queue.receive({ waitSeconds });
		const unknown: string[] = [];
		const failed: { name: string; error: unknown }[] = [];

		for (const job of received) {
			const parsed = parseOutboxJob(job.name, job.data);

			if (!parsed) {
				unknown.push(job.name);
				continue;
			}

			try {
				await this.transactions.runInAccount(parsed.accountId, () =>
					this.dispatcher.send(parsed.message),
				);
			} catch (error) {
				failed.push({ name: job.name, error });
				continue;
			}

			await this.queue.acknowledge(job.receipt);
		}

		return { received: received.length, unknown, failed };
	}
}
