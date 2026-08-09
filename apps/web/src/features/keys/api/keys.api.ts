import type { CreateDeviceRequest, CreateDeviceResponse, DeviceListResponse } from '@vpn/contracts';

import { api } from '@/app/store/api.js';

export const keysApi = api.injectEndpoints({
	overrideExisting: false,
	endpoints: (builder) => ({
		devices: builder.query<DeviceListResponse, void>({
			query: () => 'devices',
			providesTags: ['Devices'],
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

export const { useDevicesQuery, useCreateDeviceMutation, useRevokeDeviceMutation } = keysApi;
