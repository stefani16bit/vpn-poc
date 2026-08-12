import { useSelector } from 'react-redux';

import type { Permission } from '@vpn/contracts';

import { useMyPermissionsQuery } from '@/app/access/permissions.api.js';
import type { RootState } from '@/app/store/index.js';

export function useHasPermission(permission: Permission): boolean {
	const authenticated = useSelector((state: RootState) => state.auth.status === 'authenticated');
	const { data } = useMyPermissionsQuery(undefined, { skip: !authenticated });

	return data?.permissions?.includes(permission) ?? false;
}
