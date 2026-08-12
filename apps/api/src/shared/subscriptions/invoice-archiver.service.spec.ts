import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IBillingProvider, IObjectStorage } from '@vpn/ports';

import { InvoiceArchiver, invoiceObjectKey } from './invoice-archiver.service.js';
import type { InvoiceRepository } from './invoice.repository.js';

const PDF = new TextEncoder().encode('%PDF-1.4\n%%EOF\n');

describe('InvoiceArchiver', () => {
	let billing: { fetchInvoicePdf: ReturnType<typeof vi.fn> };
	let storage: { put: ReturnType<typeof vi.fn> };
	let invoices: { setPdfKey: ReturnType<typeof vi.fn> };
	let archiver: InvoiceArchiver;

	beforeEach(() => {
		billing = { fetchInvoicePdf: vi.fn().mockResolvedValue(PDF) };
		storage = { put: vi.fn().mockResolvedValue(undefined) };
		invoices = { setPdfKey: vi.fn().mockResolvedValue(undefined) };

		archiver = new InvoiceArchiver(
			billing as unknown as IBillingProvider,
			storage as unknown as IObjectStorage,
			invoices as unknown as InvoiceRepository,
		);
	});

	it('stores the document and points the row at it', async () => {
		await archiver.archive('acc-1', 'inv-1', 'in_1');

		expect(storage.put).toHaveBeenCalledWith('invoices/acc-1/in_1.pdf', PDF, 'application/pdf');
		expect(invoices.setPdfKey).toHaveBeenCalledWith('inv-1', 'invoices/acc-1/in_1.pdf');
	});

	// The key is derived, never generated: a redelivery overwrites the same bytes
	// instead of leaving a second copy nobody will ever look at.
	it('derives the same key for the same invoice, so a redelivery overwrites', async () => {
		await archiver.archive('acc-1', 'inv-1', 'in_1');
		await archiver.archive('acc-1', 'inv-1', 'in_1');

		const keys = storage.put.mock.calls.map((call) => call[0] as string);
		expect(new Set(keys).size).toBe(1);
		expect(keys[0]).toBe(invoiceObjectKey('acc-1', 'in_1'));
	});

	it('scopes the key by account, so two tenants never collide', () => {
		expect(invoiceObjectKey('acc-1', 'in_1')).not.toBe(invoiceObjectKey('acc-2', 'in_1'));
	});

	it('writes nothing when the provider has no document for it', async () => {
		billing.fetchInvoicePdf.mockResolvedValue(null);

		await archiver.archive('acc-1', 'inv-1', 'in_1');

		expect(storage.put).not.toHaveBeenCalled();
		expect(invoices.setPdfKey).not.toHaveBeenCalled();
	});

	it('points the row only after the object is there, never before', async () => {
		await archiver.archive('acc-1', 'inv-1', 'in_1');

		expect(storage.put.mock.invocationCallOrder[0]).toBeLessThan(
			invoices.setPdfKey.mock.invocationCallOrder[0] as number,
		);
	});
});
