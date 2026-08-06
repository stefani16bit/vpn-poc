import type { Middleware, UnknownAction } from '@reduxjs/toolkit';

import { logger } from '@/lib/logger.js';
import type { RootState } from './index.js';

const OFF_SWITCH = 'poc-vpn.debug.actions';

// RTK Query dispatches a subscription action per component mounting or
// unmounting a hook, and a config one when the store is built. They say nothing
// about what the app did and bury everything that does.
const BOOKKEEPING = ['api/subscriptions/', 'api/internalSubscriptions/', 'api/config/'];

function isSilenced(): boolean {
	try {
		return window.localStorage.getItem(OFF_SWITCH) === 'off';
	} catch {
		return false;
	}
}

export const actionLoggerMiddleware: Middleware<object, RootState> =
	(store) => (next) => (action) => {
		const type = (action as UnknownAction).type;

		if (typeof type !== 'string' || BOOKKEEPING.some((prefix) => type.startsWith(prefix))) {
			return next(action);
		}

		// Read per action, not once at module load: flipping the switch in devtools
		// then has to take effect without a reload.
		if (isSilenced()) return next(action);

		const prev = store.getState();
		const result = next(action);
		logger.group(type, { 'prev state': prev, action, 'next state': store.getState() });

		return result;
	};
