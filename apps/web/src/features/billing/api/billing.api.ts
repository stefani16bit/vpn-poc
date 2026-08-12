import type {
	CreateCheckoutRequest,
	CreateCheckoutResponse,
	InvoiceListResponse,
	SubscriptionResponse,
} from '@vpn/contracts';

import { api } from '@/app/store/api.js';

export const billingApi = api.injectEndpoints({
	overrideExisting: false,
	endpoints: (builder) => ({
		subscription: builder.query<SubscriptionResponse, void>({
			query: () => 'billing/subscription',
			providesTags: ['Subscription'],
		}),

		invoices: builder.query<InvoiceListResponse, void>({
			query: () => 'billing/invoices',
			providesTags: ['Invoices'],
		}),

		// responseHandler is the whole reason this is not a plain query: the
		// default parses JSON, and a PDF is not that.
		invoicePdf: builder.mutation<Blob, string>({
			query: (id) => ({
				url: `billing/invoices/${id}/pdf`,
				responseHandler: (response) => response.blob(),
			}),
		}),

		createCheckout: builder.mutation<CreateCheckoutResponse, CreateCheckoutRequest>({
			query: (body) => ({ url: 'billing/checkout', method: 'POST', body }),
		}),

		cancelSubscription: builder.mutation<SubscriptionResponse, void>({
			query: () => ({ url: 'billing/subscription', method: 'DELETE' }),
			invalidatesTags: ['Subscription', 'Entitlements'],
		}),

		resumeSubscription: builder.mutation<SubscriptionResponse, void>({
			query: () => ({ url: 'billing/subscription/resume', method: 'POST' }),
			invalidatesTags: ['Subscription', 'Entitlements'],
		}),
	}),
});

export const {
	useSubscriptionQuery,
	useInvoicesQuery,
	useInvoicePdfMutation,
	useCreateCheckoutMutation,
	useCancelSubscriptionMutation,
	useResumeSubscriptionMutation,
} = billingApi;
