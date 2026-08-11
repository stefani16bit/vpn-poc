import type {
	AssignableRole,
	CreateUserRequest,
	CreateUserResponse,
	UserListResponse,
	UserResponse,
} from '@vpn/contracts';

import { api } from '@/app/store/api.js';

export const usersApi = api.injectEndpoints({
	overrideExisting: false,
	endpoints: (builder) => ({
		accountUsers: builder.query<UserListResponse, void>({
			query: () => 'users',
			providesTags: ['Users'],
		}),

		createUser: builder.mutation<CreateUserResponse, CreateUserRequest>({
			query: (body) => ({ url: 'users', method: 'POST', body }),
			invalidatesTags: ['Users'],
		}),

		changeUserRole: builder.mutation<UserResponse, { id: string; role: AssignableRole }>({
			query: ({ id, role }) => ({ url: `users/${id}`, method: 'PATCH', body: { role } }),
			invalidatesTags: ['Users'],
		}),

		removeUser: builder.mutation<void, string>({
			query: (id) => ({ url: `users/${id}`, method: 'DELETE' }),
			invalidatesTags: ['Users'],
		}),
	}),
});

export const {
	useAccountUsersQuery,
	useCreateUserMutation,
	useChangeUserRoleMutation,
	useRemoveUserMutation,
} = usersApi;
