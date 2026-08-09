import type {
	CreateCheckoutRequest,
	CreateCheckoutResponse,
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

		createCheckout: builder.mutation<CreateCheckoutResponse, CreateCheckoutRequest>({
			query: (body) => ({ url: 'billing/checkout', method: 'POST', body }),
		}),

		cancelSubscription: builder.mutation<SubscriptionResponse, void>({
			query: () => ({ url: 'billing/subscription', method: 'DELETE' }),
			invalidatesTags: ['Subscription'],
		}),

		resumeSubscription: builder.mutation<SubscriptionResponse, void>({
			query: () => ({ url: 'billing/subscription/resume', method: 'POST' }),
			invalidatesTags: ['Subscription'],
		}),
	}),
});

export const {
	useSubscriptionQuery,
	useCreateCheckoutMutation,
	useCancelSubscriptionMutation,
	useResumeSubscriptionMutation,
} = billingApi;
