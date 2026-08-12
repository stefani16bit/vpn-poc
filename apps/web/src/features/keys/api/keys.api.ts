import type {
	CreateDeviceRequest,
	CreateDeviceResponse,
	DeviceAssigneeListResponse,
	DeviceListResponse,
} from '@vpn/contracts';

import { api } from '@/app/store/api.js';

export const keysApi = api.injectEndpoints({
	overrideExisting: false,
	endpoints: (builder) => ({
		devices: builder.query<DeviceListResponse, void>({
			query: () => 'devices',
			providesTags: ['Devices'],
		}),

		deviceAssignees: builder.query<DeviceAssigneeListResponse, void>({
			query: () => 'devices/assignees',
			providesTags: ['Users'],
		}),

		createDevice: builder.mutation<CreateDeviceResponse, CreateDeviceRequest>({
			query: (body) => ({ url: 'devices', method: 'POST', body }),
			invalidatesTags: ['Devices'],
		}),

		revokeDevice: builder.mutation<void, string>({
			query: (id) => ({ url: `devices/${id}`, method: 'DELETE' }),
			invalidatesTags: ['Devices'],
		}),
	}),
});

export const {
	useDevicesQuery,
	useDeviceAssigneesQuery,
	useCreateDeviceMutation,
	useRevokeDeviceMutation,
} = keysApi;
