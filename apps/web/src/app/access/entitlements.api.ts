import type { EntitlementsResponse } from '@vpn/contracts';

import { api } from '@/app/store/api.js';

export const entitlementsApi = api.injectEndpoints({
	overrideExisting: false,
	endpoints: (builder) => ({
		entitlements: builder.query<EntitlementsResponse, void>({
			query: () => 'entitlements',
			providesTags: ['Entitlements'],
		}),
	}),
});

export const { useEntitlementsQuery } = entitlementsApi;
