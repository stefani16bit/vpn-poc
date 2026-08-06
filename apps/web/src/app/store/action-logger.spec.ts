import { configureStore } from '@reduxjs/toolkit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { stubApi } from '@/test-utils.tsx';
import { authApi } from '@/features/auth/api/auth.api.js';
import { actionLoggerMiddleware } from './action-logger.js';
import { api } from './api.js';
import { sessionResolved } from './auth-slice.js';
import { rootReducer } from './index.js';

const user = {
	id: '00000000-0000-0000-0000-000000000001',
	email: 'ada@example.com',
	emailVerified: true,
	locale: 'pt-BR' as const,
	createdAt: '2026-01-01T00:00:00.000Z',
};

function loggedStore() {
	return configureStore({
		reducer: rootReducer,
		middleware: (getDefaultMiddleware) =>
			getDefaultMiddleware().prepend(actionLoggerMiddleware).concat(api.middleware),
	});
}

let groups: unknown[][];
let lines: unknown[][];

beforeEach(() => {
	groups = [];
	lines = [];
	vi.spyOn(console, 'groupCollapsed').mockImplementation((...args: unknown[]) => {
		groups.push(args);
	});
	vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
		lines.push(args);
	});
	vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	window.localStorage.clear();
});

describe('actionLoggerMiddleware', () => {
	it('opens a group labelled with the action type', () => {
		loggedStore().dispatch(sessionResolved({ user, accessToken: 'jwt' }));

		expect(groups.flat()).toContain('auth/sessionResolved');
	});

	it('shows the state on both sides of the action', () => {
		const store = loggedStore();
		store.dispatch(sessionResolved({ user, accessToken: 'jwt' }));

		const labels = lines.map((line) => line[0]);
		expect(labels).toEqual(['prev state', 'action', 'next state']);
	});

	it('redacts the access token from the action and from the state', () => {
		loggedStore().dispatch(sessionResolved({ user, accessToken: 'jwt' }));

		expect(JSON.stringify(lines)).not.toContain('jwt');
		expect(JSON.stringify(lines)).toContain('[REDACTED]');
	});

	it('keeps the request lifecycle, which is where the bugs are', async () => {
		const stub = stubApi();
		stub.reply(user);
		const store = loggedStore();

		await store.dispatch(authApi.endpoints.me.initiate());

		expect(groups.flat().filter((label) => String(label).includes('executeQuery'))).not.toEqual([]);
	});

	it('drops the subscription bookkeeping', () => {
		loggedStore().dispatch({
			type: 'api/subscriptions/unsubscribeQueryResult',
			payload: { queryCacheKey: 'me(undefined)', requestId: 'r1' },
		});

		expect(groups).toEqual([]);
	});

	it('stays quiet when the off switch is set', () => {
		window.localStorage.setItem('poc-vpn.debug.actions', 'off');
		loggedStore().dispatch(sessionResolved({ user, accessToken: 'jwt' }));

		expect(groups).toEqual([]);
	});

	it('survives a browser with no storage at all', () => {
		vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
			throw new Error('storage disabled');
		});

		expect(() =>
			loggedStore().dispatch(sessionResolved({ user, accessToken: 'jwt' })),
		).not.toThrow();
		expect(groups.flat()).toContain('auth/sessionResolved');
	});
});
