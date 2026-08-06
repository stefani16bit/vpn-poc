import {
	combineReducers,
	configureStore,
	createListenerMiddleware,
	type Middleware,
} from '@reduxjs/toolkit';
import { createStateSyncMiddleware, withReduxStateSync } from 'redux-state-sync';

import { api } from './api.js';
import { AUTH_SYNCED_ACTIONS, authReducer, sessionCleared } from './auth-slice.js';

const clearApiCache = createListenerMiddleware();
clearApiCache.startListening({
	actionCreator: sessionCleared,
	effect: (_action, listenerApi) => {
		listenerApi.dispatch(api.util.resetApiState());
	},
});

export const rootReducer = combineReducers({
	[api.reducerPath]: api.reducer,
	auth: authReducer,
});

const stateSyncMiddleware = createStateSyncMiddleware({
	whitelist: [...AUTH_SYNCED_ACTIONS],
}) as unknown as Middleware;

export const store = configureStore({
	reducer: withReduxStateSync(rootReducer),
	middleware: (getDefaultMiddleware) =>
		getDefaultMiddleware()
			.prepend(clearApiCache.middleware)
			.concat(api.middleware, stateSyncMiddleware),
});

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
