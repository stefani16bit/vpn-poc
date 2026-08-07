import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { outbox, type Database } from '@vpn-poc/database';
import type { JobEnvelope } from '@vpn/ports';

import type { Executor } from '../database/transaction-runner.js';
import type { OutboxMessage } from './outbox-message.js';

export interface PendingEntry {
	readonly id: string;
	readonly job: JobEnvelope;
}

@Injectable()
export class OutboxRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async enqueue(message: OutboxMessage, executor: Executor = this.db): Promise<void> {
		await executor.insert(outbox).values({ kind: message.kind, payload: message });
	}

	async claimPending(limit: number, executor: Executor): Promise<readonly PendingEntry[]> {
		const rows = await executor.execute<{ id: string; kind: string; payload: OutboxMessage }>(sql`
			select id, kind, payload from outbox
			where published_at is null
			order by created_at
			for update skip locked
			limit ${limit}
		`);

		return [...rows].map((row) => ({
			id: row.id,
			job: { name: row.kind, data: row.payload },
		}));
	}

	async markPublished(id: string, executor: Executor = this.db): Promise<void> {
		await executor
			.update(outbox)
			.set({ publishedAt: new Date(), attempts: sql`${outbox.attempts} + 1` })
			.where(eq(outbox.id, id));
	}
}
