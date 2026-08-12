import type { ReactNode } from 'react';

import type { Invoice } from '@vpn/contracts';

import { normalizeError } from '@/app/store/api-error.js';
import { FormError } from '@/components/form/form-error.tsx';
import { Loading } from '@/components/layout/loading.tsx';
import { Nav } from '@/components/layout/nav.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card.tsx';
import { useInvoicePdfMutation, useInvoicesQuery } from '@/features/billing/api/billing.api.js';
import { useLocale } from '@/i18n/locale-context.tsx';
import { downloadBlob } from '@/lib/download.js';

export function InvoicesPage(): ReactNode {
	const { t, locale } = useLocale();
	const invoices = useInvoicesQuery();
	const [fetchPdf, pdfState] = useInvoicePdfMutation();

	async function download(invoice: Invoice): Promise<void> {
		const result = await fetchPdf(invoice.id);
		if (!('data' in result) || !result.data) return;

		downloadBlob(`invoice-${invoice.number ?? invoice.id}.pdf`, result.data);
	}

	return (
		<Card className="w-full max-w-md">
			<CardHeader>
				<CardTitle className="text-xl">{t('billing.invoices.title')}</CardTitle>
			</CardHeader>

			<CardContent>
				<p className="text-muted-foreground">{t('billing.invoices.intro')}</p>

				<FormError error={normalizeError(pdfState.error ?? invoices.error)} />

				<div className="mt-6">
					{invoices.isLoading ? (
						<Loading />
					) : (
						<InvoiceList
							invoices={invoices.data?.invoices ?? []}
							pending={pdfState.isLoading}
							onDownload={(invoice) => void download(invoice)}
							locale={locale}
							t={t}
						/>
					)}
				</div>

				<Nav />
			</CardContent>
		</Card>
	);
}

function InvoiceList({
	invoices,
	pending,
	onDownload,
	locale,
	t,
}: {
	invoices: readonly Invoice[];
	pending: boolean;
	onDownload: (invoice: Invoice) => void;
	locale: string;
	t: ReturnType<typeof useLocale>['t'];
}): ReactNode {
	if (invoices.length === 0)
		return <p className="text-muted-foreground">{t('billing.invoices.empty')}</p>;

	return (
		<ul className="grid gap-3">
			{invoices.map((invoice) => (
				<li key={invoice.id} className="grid gap-1 rounded-md border p-3">
					<div className="flex items-center justify-between gap-4">
						<span className="font-medium">
							{new Intl.NumberFormat(locale, {
								style: 'currency',
								currency: invoice.currency.toUpperCase(),
							}).format(invoice.amountCents / 100)}
						</span>

						<span className="text-sm" role="status">
							{invoice.status === 'paid'
								? t('billing.invoices.statusPaid')
								: t('billing.invoices.statusFailed')}
						</span>
					</div>

					{invoice.number ? (
						<span className="text-sm text-muted-foreground">
							{t('billing.invoices.number', { number: invoice.number })}
						</span>
					) : null}

					<span className="text-sm text-muted-foreground">
						{t('billing.invoices.issuedAt', {
							date: new Date(invoice.issuedAt).toLocaleDateString(locale),
						})}
					</span>

					{invoice.archived ? (
						<Button
							type="button"
							variant="link"
							className="h-auto justify-self-start p-0"
							disabled={pending}
							onClick={() => onDownload(invoice)}
						>
							{t('billing.invoices.download')}
						</Button>
					) : (
						<span className="text-sm text-muted-foreground">{t('billing.invoices.archiving')}</span>
					)}
				</li>
			))}
		</ul>
	);
}
