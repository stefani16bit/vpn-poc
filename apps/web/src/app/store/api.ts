import { createApi } from '@reduxjs/toolkit/query/react';

import { baseQueryWithRefresh } from './base-query.js';

export const api = createApi({
	reducerPath: 'api',
	baseQuery: baseQueryWithRefresh,
	tagTypes: [
		'Session',
		'Subscription',
		'Entitlements',
		'Devices',
		'Users',
		'Permissions',
		'Invoices',
	],
	endpoints: () => ({}),
});
