import type { BaseQueryFn, FetchArgs, FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { fetchBaseQuery } from '@reduxjs/toolkit/query/react';

import type { SessionResponse } from '@vpn/contracts';

import { readStoredLocale } from '@/i18n/locale-context.js';
import { API_BASE_URL } from '@/lib/api-url.js';
import { logger } from '@/lib/logger.js';
import { normalizeError } from './api-error.js';
import { sessionCleared, sessionResolved } from './auth-slice.js';
import type { RootState } from './index.js';

const rawBaseQuery = fetchBaseQuery({
	baseUrl: API_BASE_URL,
	credentials: 'include',
	prepareHeaders: (headers, { getState }) => {
		const token = (getState() as RootState).auth.accessToken;
		if (token) headers.set('authorization', `Bearer ${token}`);
		headers.set('accept-language', readStoredLocale());
		return headers;
	},
});

let refreshInFlight: Promise<SessionResponse | null> | null = null;

export const baseQueryWithRefresh: BaseQueryFn<
	string | FetchArgs,
	unknown,
	FetchBaseQueryError
> = async (args, api, extraOptions) => {
	let result = await rawBaseQuery(args, api, extraOptions);

	const normalized = normalizeError(result.error);
	const url = typeof args === 'string' ? args : String(args.url);
	const isAuthRoute = url.startsWith('auth/');
	const hadSession = (api.getState() as RootState).auth.status === 'authenticated';

	if (normalized?.status === 401 && !isAuthRoute && hadSession) {
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
			url,
			code: finalError.code,
			status: finalError.status,
			correlationId: finalError.correlationId,
		});
	}

	return result;
};
