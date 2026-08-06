import { describe, expect, it } from 'vitest';

import { normalizeError } from './api-error.js';
import { authReducer, sessionCleared, sessionResolved, sessionUnknown } from './auth-slice.js';

const user = {
	id: '00000000-0000-0000-0000-000000000001',
	email: 'ada@example.com',
	emailVerified: true,
	locale: 'pt-BR' as const,
	createdAt: '2026-01-01T00:00:00.000Z',
};

describe('authReducer', () => {
	it('starts in the unknown state, not logged out', () => {
		expect(authReducer(undefined, { type: '@@INIT' }).status).toBe('unknown');
	});

	it('stores the session', () => {
		const state = authReducer(undefined, sessionResolved({ user, accessToken: 'jwt' }));
		expect(state).toMatchObject({ status: 'authenticated', accessToken: 'jwt' });
	});

	it('drops the token when the session is cleared', () => {
		const authenticated = authReducer(undefined, sessionResolved({ user, accessToken: 'jwt' }));
		expect(authReducer(authenticated, sessionCleared())).toMatchObject({
			status: 'unauthenticated',
			user: null,
			accessToken: null,
		});
	});

	it('drops the token when returning to unknown', () => {
		const authenticated = authReducer(undefined, sessionResolved({ user, accessToken: 'jwt' }));
		expect(authReducer(authenticated, sessionUnknown()).accessToken).toBeNull();
	});
});

describe('normalizeError', () => {
	it('returns null when there is no error', () => {
		expect(normalizeError(undefined)).toBeNull();
	});

	it('unwraps an ApiErrorResponse from the server', () => {
		const normalized = normalizeError({
			status: 401,
			data: { code: 'INVALID_CREDENTIALS', message: 'nope', correlationId: 'abc' },
		});

		expect(normalized).toMatchObject({
			code: 'INVALID_CREDENTIALS',
			status: 401,
			correlationId: 'abc',
		});
	});

	it('carries field errors through', () => {
		const normalized = normalizeError({
			status: 400,
			data: {
				code: 'VALIDATION_FAILED',
				message: 'bad',
				correlationId: 'abc',
				fields: { password: 'too short' },
			},
		});

		expect(normalized?.fields).toEqual({ password: 'too short' });
	});

	it('reports a transport failure distinctly', () => {
		expect(normalizeError({ status: 'FETCH_ERROR', error: 'failed' })).toMatchObject({
			code: '_NETWORK_ERROR',
			correlationId: null,
		});
	});

	it('reports an unreadable body distinctly from a network failure', () => {
		const normalized = normalizeError({
			status: 'PARSING_ERROR',
			originalStatus: 502,
			data: '<html>',
			error: 'bad json',
		});
		expect(normalized).toMatchObject({ code: '_PARSE_ERROR', status: 502 });
	});

	it('falls back to unknown for a server response that is not ours', () => {
		expect(normalizeError({ status: 500, data: '<html>gateway</html>' })).toMatchObject({
			code: '_UNKNOWN_ERROR',
			status: 500,
		});
	});

	it('handles a thrown error with no HTTP status at all', () => {
		expect(normalizeError({ message: 'boom', name: 'Error' })).toMatchObject({
			code: '_UNKNOWN_ERROR',
			message: 'boom',
		});
	});
});
