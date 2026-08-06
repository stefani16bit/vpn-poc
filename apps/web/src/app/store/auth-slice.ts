import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { AuthenticatedUser } from '@vpn/contracts';

export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated';

export interface AuthState {
	readonly status: AuthStatus;
	readonly user: AuthenticatedUser | null;
	readonly accessToken: string | null;
}

const initialState: AuthState = { status: 'unknown', user: null, accessToken: null };

const authSlice = createSlice({
	name: 'auth',
	initialState,
	reducers: {
		sessionResolved(
			state,
			action: PayloadAction<{ user: AuthenticatedUser; accessToken: string }>,
		) {
			state.status = 'authenticated';
			state.user = action.payload.user;
			state.accessToken = action.payload.accessToken;
		},
		sessionCleared(state) {
			state.status = 'unauthenticated';
			state.user = null;
			state.accessToken = null;
		},
		sessionUnknown(state) {
			state.status = 'unknown';
			state.user = null;
			state.accessToken = null;
		},
	},
});

export const { sessionResolved, sessionCleared, sessionUnknown } = authSlice.actions;
export const authReducer = authSlice.reducer;

export const AUTH_SYNCED_ACTIONS = [sessionResolved.type, sessionCleared.type] as const;
