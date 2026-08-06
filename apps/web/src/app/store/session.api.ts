import type { AcknowledgedResponse } from '@vpn/contracts';

import { api } from './api.js';

export const sessionApi = api.injectEndpoints({
	overrideExisting: false,
	endpoints: (builder) => ({
		logout: builder.mutation<AcknowledgedResponse, void>({
			query: () => ({ url: 'auth/logout', method: 'POST' }),
		}),
	}),
});

export const { useLogoutMutation } = sessionApi;
