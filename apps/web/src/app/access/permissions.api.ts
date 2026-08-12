import type { PermissionGrant, PermissionsResponse, RoleGrantsResponse } from '@vpn/contracts';

import { api } from '@/app/store/api.js';

export const permissionsApi = api.injectEndpoints({
	overrideExisting: false,
	endpoints: (builder) => ({
		myPermissions: builder.query<PermissionsResponse, void>({
			query: () => 'permissions',
			providesTags: ['Permissions'],
		}),

		permissionGrants: builder.query<RoleGrantsResponse, void>({
			query: () => 'permissions/grants',
			providesTags: ['Permissions'],
		}),

		setRoleGrant: builder.mutation<RoleGrantsResponse, { role: string; grant: PermissionGrant }>({
			query: ({ role, grant }) => ({
				url: `permissions/roles/${role}`,
				method: 'PUT',
				body: grant,
			}),
			invalidatesTags: ['Permissions', 'Devices', 'Users'],
		}),

		setUserGrant: builder.mutation<RoleGrantsResponse, { userId: string; grant: PermissionGrant }>({
			query: ({ userId, grant }) => ({
				url: `permissions/users/${userId}`,
				method: 'PUT',
				body: grant,
			}),
			invalidatesTags: ['Permissions', 'Devices', 'Users'],
		}),
	}),
});

export const {
	useMyPermissionsQuery,
	usePermissionGrantsQuery,
	useSetRoleGrantMutation,
	useSetUserGrantMutation,
} = permissionsApi;
