import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';

import { useSubscriptionStatus } from '@/app/access/use-subscription-status.js';
import { Loading } from '@/components/layout/loading.tsx';

export function RequireSubscription({ children }: { children: ReactNode }): ReactNode {
	const status = useSubscriptionStatus();

	if (status === 'unknown') return <Loading />;
	if (status === 'unsubscribed') return <Navigate to="/account" replace />;

	return children;
}
