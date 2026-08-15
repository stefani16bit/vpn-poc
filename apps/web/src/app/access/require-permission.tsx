import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import type { Permission } from '@vpn/contracts';

import { usePermissionStatus } from '@/app/access/use-has-permission.js';
import { Loading } from '@/components/layout/loading.tsx';

export function RequirePermission({
	anyOf,
	children,
}: {
	anyOf: readonly Permission[];
	children: ReactNode;
}): ReactNode {
	const status = usePermissionStatus(anyOf);

	if (status === 'unknown') return <Loading />;
	if (status === 'denied') return <Navigate to="/account" replace />;

	return children;
}
