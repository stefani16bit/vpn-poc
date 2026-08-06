import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import type {
	AcknowledgedResponse,
	AuthenticatedUser,
	CreateCheckoutRequest,
	CreateCheckoutResponse,
	ForgotPasswordRequest,
	LoginRequest,
	RegisterRequest,
	ResendVerificationRequest,
	ResetPasswordRequest,
	SessionResponse,
	SubscriptionResponse,
	UpdateLocaleRequest,
	VerifyEmailRequest,
} from '@vpn/contracts';

import { readStoredLocale } from '../../i18n/locale-context.js';
import { logger } from '../../lib/logger.js';
import { normalizeError } from './api-error.js';
import { sessionCleared, sessionResolved } from './auth-slice.js';
import type { RootState } from './index.js';

const baseUrl = import.meta.env['VITE_API_URL'] ?? '/api';

const rawBaseQuery = fetchBaseQuery({
	baseUrl,
	credentials: 'include',
	prepareHeaders: (headers, { getState }) => {
		const token = (getState() as RootState).auth.accessToken;
		if (token) headers.set('authorization', `Bearer ${token}`);
		headers.set('accept-language', readStoredLocale());
		return headers;
	},
});

let refreshInFlight: Promise<SessionResponse | null> | null = null;

const baseQueryWithRefresh: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (
	args,
	api,
	extraOptions,
) => {
	let result = await rawBaseQuery(args, api, extraOptions);

	const normalized = normalizeError(result.error);
	const isAuthRoute = typeof args !== 'string' && String(args.url).startsWith('auth/');

	if (normalized?.status === 401 && !isAuthRoute) {
		refreshInFlight ??= (async () => {
			const refreshed = await rawBaseQuery(
				{ url: 'auth/refresh', method: 'POST' },
				api,
				extraOptions,
			);
			return refreshed.data ? (refreshed.data as SessionResponse) : null;
		})().finally(() => {
			refreshInFlight = null;
		});

		const session = await refreshInFlight;

		if (session) {
			api.dispatch(sessionResolved({ user: session.user, accessToken: session.accessToken }));
			result = await rawBaseQuery(args, api, extraOptions);
		} else {
			api.dispatch(sessionCleared());
		}
	}

	const finalError = normalizeError(result.error);
	if (finalError) {
		logger.warn('api error', {
			url: typeof args === 'string' ? args : args.url,
			code: finalError.code,
			status: finalError.status,
			correlationId: finalError.correlationId,
		});
	}

	return result;
};

export const api = createApi({
	reducerPath: 'api',
	baseQuery: baseQueryWithRefresh,
	tagTypes: ['Session', 'Subscription'],
	endpoints: (builder) => ({
		me: builder.query<AuthenticatedUser, void>({
			query: () => 'auth/me',
			providesTags: ['Session'],
		}),

		login: builder.mutation<SessionResponse, LoginRequest>({
			query: (body) => ({ url: 'auth/login', method: 'POST', body }),
			invalidatesTags: ['Session', 'Subscription'],
		}),

		register: builder.mutation<AcknowledgedResponse, RegisterRequest>({
			query: (body) => ({ url: 'auth/register', method: 'POST', body }),
		}),

		verifyEmail: builder.mutation<AcknowledgedResponse, VerifyEmailRequest>({
			query: (body) => ({ url: 'auth/verify-email', method: 'POST', body }),
			invalidatesTags: ['Session'],
		}),

		resendVerification: builder.mutation<AcknowledgedResponse, ResendVerificationRequest>({
			query: (body) => ({ url: 'auth/resend-verification', method: 'POST', body }),
		}),

		forgotPassword: builder.mutation<AcknowledgedResponse, ForgotPasswordRequest>({
			query: (body) => ({ url: 'auth/forgot-password', method: 'POST', body }),
		}),

		resetPassword: builder.mutation<AcknowledgedResponse, ResetPasswordRequest>({
			query: (body) => ({ url: 'auth/reset-password', method: 'POST', body }),
		}),

		updateLocale: builder.mutation<AuthenticatedUser, UpdateLocaleRequest>({
			query: (body) => ({ url: 'auth/me/locale', method: 'PATCH', body }),
			invalidatesTags: ['Session'],
		}),

		logout: builder.mutation<AcknowledgedResponse, void>({
			query: () => ({ url: 'auth/logout', method: 'POST' }),
		}),

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
	}),
});

export const {
	useMeQuery,
	useLoginMutation,
	useRegisterMutation,
	useVerifyEmailMutation,
	useResendVerificationMutation,
	useForgotPasswordMutation,
	useResetPasswordMutation,
	useLogoutMutation,
	useUpdateLocaleMutation,
	useSubscriptionQuery,
	useCreateCheckoutMutation,
	useCancelSubscriptionMutation,
} = api;
