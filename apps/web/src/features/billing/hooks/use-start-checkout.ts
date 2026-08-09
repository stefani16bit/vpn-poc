import type { SerializedError } from '@reduxjs/toolkit';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';

import type { Cadence } from '@vpn/contracts';

import { useCreateCheckoutMutation } from '@/features/billing/api/billing.api.js';

export interface StartCheckout {
	readonly start: (cadence: Cadence) => Promise<void>;
	readonly pending: boolean;
	readonly error: FetchBaseQueryError | SerializedError | undefined;
}

export function useStartCheckout(): StartCheckout {
	const [createCheckout, state] = useCreateCheckoutMutation();

	async function start(cadence: Cadence): Promise<void> {
		const result = await createCheckout({ tier: 'pro', cadence });
		if ('data' in result && result.data) window.location.assign(result.data.checkoutUrl);
	}

	return { start, pending: state.isLoading, error: state.error };
}
