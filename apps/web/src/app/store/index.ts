import {
	combineReducers,
	configureStore,
	createListenerMiddleware,
	type Middleware,
} from '@reduxjs/toolkit';
import { createStateSyncMiddleware, withReduxStateSync } from 'redux-state-sync';

import { actionLoggerMiddleware } from './action-logger.js';
import { api } from './api.js';
import { AUTH_SYNCED_ACTIONS, authReducer, sessionCleared } from './auth-slice.js';

const clearApiCache = createListenerMiddleware<RootState>();
clearApiCache.startListening({
	actionCreator: sessionCleared,
	effect: (_action, listenerApi) => {
		// At boot there is nothing cached to drop, and resetApiState aborts every
		// request in flight — including the one an anonymous page just started.
		if (listenerApi.getOriginalState().auth.status !== 'authenticated') return;
		listenerApi.dispatch(api.util.resetApiState());
	},
});

export const clearApiCacheMiddleware = clearApiCache.middleware;

export const rootReducer = combineReducers({
	[api.reducerPath]: api.reducer,
	auth: authReducer,
});

const stateSyncMiddleware = createStateSyncMiddleware({
	whitelist: [...AUTH_SYNCED_ACTIONS],
}) as unknown as Middleware;

export const store = configureStore({
	reducer: withReduxStateSync(rootReducer),
	middleware: (getDefaultMiddleware) => {
		const chain = getDefaultMiddleware()
			.prepend(clearApiCacheMiddleware)
			.concat(api.middleware, stateSyncMiddleware);

		return import.meta.env.DEV ? chain.prepend(actionLoggerMiddleware) : chain;
	},
});

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
