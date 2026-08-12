import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';

import { DATABASE } from '@vpn-poc/adapters';
import { invoices, type Database } from '@vpn-poc/database';
import type { Invoice } from '@vpn/ports';

import { currentExecutor } from '../database/db-scope.js';
import type { Executor } from '../database/transaction-runner.js';

export interface StoredInvoice {
	readonly id: string;
	readonly externalId: string;
	readonly number: string | null;
	readonly status: typeof invoices.$inferSelect.status;
	readonly amountCents: number;
	readonly currency: string;
	readonly issuedAt: Date;
	readonly pdfKey: string | null;
}

@Injectable()
export class InvoiceRepository {
	constructor(@Inject(DATABASE) private readonly db: Database) {}

	async listByAccount(
		accountId: string,
		executor: Executor = currentExecutor(),
	): Promise<readonly StoredInvoice[]> {
		return executor
			.select({
				id: invoices.id,
				externalId: invoices.externalId,
				number: invoices.number,
				status: invoices.status,
				amountCents: invoices.amountCents,
				currency: invoices.currency,
				issuedAt: invoices.issuedAt,
				pdfKey: invoices.pdfKey,
			})
			.from(invoices)
			.where(eq(invoices.accountId, accountId))
			.orderBy(desc(invoices.issuedAt));
	}

	async findById(
		accountId: string,
		id: string,
		executor: Executor = currentExecutor(),
	): Promise<StoredInvoice | undefined> {
		const rows = await executor
			.select({
				id: invoices.id,
				externalId: invoices.externalId,
				number: invoices.number,
				status: invoices.status,
				amountCents: invoices.amountCents,
				currency: invoices.currency,
				issuedAt: invoices.issuedAt,
				pdfKey: invoices.pdfKey,
			})
			.from(invoices)
			.where(and(eq(invoices.accountId, accountId), eq(invoices.id, id)))
			.limit(1);

		return rows[0];
	}

	async upsert(
		accountId: string,
		invoice: Invoice,
		occurredAt: Date,
		executor: Executor = currentExecutor(),
	): Promise<string | undefined> {
		const applied = await executor
			.insert(invoices)
			.values({
				accountId,
				externalId: invoice.externalId,
				number: invoice.number,
				status: invoice.status,
				amountCents: invoice.amountCents,
				currency: invoice.currency,
				issuedAt: invoice.issuedAt,
				lastEventAt: occurredAt,
			})
			.onConflictDoUpdate({
				target: [invoices.accountId, invoices.externalId],
				set: {
					number: invoice.number,
					status: invoice.status,
					amountCents: invoice.amountCents,
					currency: invoice.currency,
					issuedAt: invoice.issuedAt,
					lastEventAt: occurredAt,
					updatedAt: new Date(),
				},
				setWhere: sql`${invoices.lastEventAt} is null or ${invoices.lastEventAt} < ${occurredAt.toISOString()}::timestamptz`,
			})
			.returning({ id: invoices.id });

		return applied[0]?.id;
	}

	async setPdfKey(
		id: string,
		pdfKey: string,
		executor: Executor = currentExecutor(),
	): Promise<void> {
		await executor
			.update(invoices)
			.set({ pdfKey, updatedAt: new Date() })
			.where(eq(invoices.id, id));
	}
}
