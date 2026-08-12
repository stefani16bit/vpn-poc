import { Inject, Injectable } from '@nestjs/common';

import {
	BILLING_PROVIDER,
	OBJECT_STORAGE,
	type IBillingProvider,
	type IObjectStorage,
} from '@vpn/ports';

import { InvoiceRepository } from './invoice.repository.js';

const CONTENT_TYPE = 'application/pdf';

export function invoiceObjectKey(accountId: string, externalInvoiceId: string): string {
	return `invoices/${accountId}/${externalInvoiceId}.pdf`;
}

@Injectable()
export class InvoiceArchiver {
	constructor(
		@Inject(BILLING_PROVIDER) private readonly billing: IBillingProvider,
		@Inject(OBJECT_STORAGE) private readonly storage: IObjectStorage,
		private readonly invoices: InvoiceRepository,
	) {}

	async archive(accountId: string, invoiceId: string, externalInvoiceId: string): Promise<void> {
		const pdf = await this.billing.fetchInvoicePdf(externalInvoiceId);
		if (!pdf) return;

		const key = invoiceObjectKey(accountId, externalInvoiceId);
		await this.storage.put(key, pdf, CONTENT_TYPE);
		await this.invoices.setPdfKey(invoiceId, key);
	}
}
