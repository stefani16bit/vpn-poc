import { useSelector } from 'react-redux';

import { useEntitlementsQuery } from '@/app/access/entitlements.api.js';
import type { RootState } from '@/app/store/index.js';

export type SubscriptionStatus = 'unknown' | 'subscribed' | 'unsubscribed';

export function useSubscriptionStatus(): SubscriptionStatus {
	const authenticated = useSelector((state: RootState) => state.auth.status === 'authenticated');
	const { data, isError } = useEntitlementsQuery(undefined, { skip: !authenticated });

	if (!authenticated) return 'unsubscribed';
	if (isError) return 'unsubscribed';
	if (!data) return 'unknown';

	return data.tier === null ? 'unsubscribed' : 'subscribed';
}
