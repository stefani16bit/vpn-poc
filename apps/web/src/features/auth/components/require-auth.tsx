import type { ReactNode } from 'react';
import { useSelector } from 'react-redux';
import { Navigate, useLocation } from 'react-router-dom';

import type { RootState } from '@/app/store/index.js';
import { Loading } from '@/components/layout/loading.tsx';

export interface RequireAuthProps {
	readonly children: ReactNode;
	readonly allowUnverified?: boolean;
}

export function RequireAuth({ children, allowUnverified = false }: RequireAuthProps): ReactNode {
	const auth = useSelector((state: RootState) => state.auth);
	const location = useLocation();

	if (auth.status === 'unknown') return <Loading />;

	if (auth.status === 'unauthenticated') {
		return <Navigate to="/login" replace state={{ from: location.pathname }} />;
	}

	if (!allowUnverified && auth.user && !auth.user.emailVerified) {
		return <Navigate to="/verify-email" replace />;
	}

	return children;
}
