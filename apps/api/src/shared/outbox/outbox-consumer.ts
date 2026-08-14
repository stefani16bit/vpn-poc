import { Inject, Injectable } from '@nestjs/common';

import { JOB_QUEUE, type IJobQueue } from '@vpn/ports';

import { TransactionRunner } from '../database/transaction-runner.js';
import { DeviceProvisioner } from '../devices/device-provisioner.service.js';
import { NotificationDispatcher } from '../notifications/notification-dispatcher.js';
import { InvoiceArchiver } from '../subscriptions/invoice-archiver.service.js';
import { parseOutboxJob, type OutboxMessage } from './outbox-message.js';

export interface ConsumerReport {
	readonly received: number;
	readonly unknown: readonly string[];
	readonly failed: readonly { name: string; error: unknown }[];
}

@Injectable()
export class OutboxConsumer {
	constructor(
		@Inject(JOB_QUEUE) private readonly queue: IJobQueue,
		private readonly dispatcher: NotificationDispatcher,
		private readonly provisioner: DeviceProvisioner,
		private readonly archiver: InvoiceArchiver,
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
					this.#apply(parsed.accountId, parsed.message),
				);
			} catch (error) {
				failed.push({ name: job.name, error });
				continue;
			}

			await this.queue.acknowledge(job.receipt);
		}

		return { received: received.length, unknown, failed };
	}

	async #apply(accountId: string, message: OutboxMessage): Promise<void> {
		switch (message.kind) {
			case 'device.provision':
				return this.provisioner.provision(message.deviceId);
			case 'device.revoke':
				return this.provisioner.revoke(message.publicKey, message.exitNodeId);
			case 'billing.invoice_archive':
				return this.archiver.archive(accountId, message.invoiceId, message.externalInvoiceId);
			default:
				return this.dispatcher.send(message);
		}
	}
}
