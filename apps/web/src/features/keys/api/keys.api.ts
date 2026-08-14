import type {
	CreateDeviceRequest,
	CreateDeviceResponse,
	DeviceAssigneeListResponse,
	DeviceListResponse,
	RegionListResponse,
} from '@vpn/contracts';

import { api } from '@/app/store/api.js';

export const keysApi = api.injectEndpoints({
	overrideExisting: false,
	endpoints: (builder) => ({
		// The fleet is ours and no screen manages it, so the one read the key form
		// needs lives beside the form rather than next to the store: there is no
		// second feature to share it with any more.
		regions: builder.query<RegionListResponse, void>({
			query: () => 'regions',
			providesTags: ['Regions'],
		}),

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
	useRegionsQuery,
	useDevicesQuery,
	useDeviceAssigneesQuery,
	useCreateDeviceMutation,
	useRevokeDeviceMutation,
} = keysApi;
