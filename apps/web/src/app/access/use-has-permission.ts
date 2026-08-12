import { useSelector } from 'react-redux';

import type { Permission } from '@vpn/contracts';

import { useMyPermissionsQuery } from '@/app/access/permissions.api.js';
import type { RootState } from '@/app/store/index.js';

export type PermissionStatus = 'unknown' | 'allowed' | 'denied';

export function usePermissionStatus(anyOf: readonly Permission[]): PermissionStatus {
	const authenticated = useSelector((state: RootState) => state.auth.status === 'authenticated');
	const { data, isError } = useMyPermissionsQuery(undefined, { skip: !authenticated });

	if (!authenticated) return 'denied';
	if (isError) return 'denied';
	if (!data) return 'unknown';

	const held = data.permissions ?? [];

	return anyOf.some((permission) => held.includes(permission)) ? 'allowed' : 'denied';
}

export function useHasPermission(permission: Permission): boolean {
	return usePermissionStatus([permission]) === 'allowed';
}
