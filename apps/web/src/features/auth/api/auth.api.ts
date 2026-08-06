import type {
	AcknowledgedResponse,
	AuthenticatedUser,
	ForgotPasswordRequest,
	LoginRequest,
	RegisterRequest,
	ResendVerificationRequest,
	ResetPasswordRequest,
	SessionResponse,
	UpdateLocaleRequest,
	VerifyEmailRequest,
} from '@vpn/contracts';

import { api } from '@/app/store/api.js';

export const authApi = api.injectEndpoints({
	overrideExisting: false,
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
	useUpdateLocaleMutation,
	useLogoutMutation,
} = authApi;
