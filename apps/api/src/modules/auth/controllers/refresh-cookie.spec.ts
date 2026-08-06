import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '@vpn-poc/env';

import { REFRESH_COOKIE, RefreshCookie } from './refresh-cookie.js';

// RefreshCookie reads one field off Env; the cast avoids building the rest.
function cookieFor(nodeEnv: Env['NODE_ENV']): RefreshCookie {
	return new RefreshCookie({ NODE_ENV: nodeEnv } as Env);
}

function responseSpy(): { response: Response; cookie: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn> } {
	const cookie = vi.fn();
	const clear = vi.fn();
	return { response: { cookie, clearCookie: clear } as unknown as Response, cookie, clear };
}

function requestWith(cookies: Record<string, string> | undefined): Request {
	return { cookies } as unknown as Request;
}

describe('RefreshCookie', () => {
	it('reads the token out of the request cookies', () => {
		const request = requestWith({ [REFRESH_COOKIE]: 'the-token' });
		expect(cookieFor('development').read(request)).toBe('the-token');
	});

	it('reads undefined when the cookie is absent', () => {
		expect(cookieFor('development').read(requestWith({}))).toBeUndefined();
	});

	it('reads undefined when the request was never cookie-parsed', () => {
		expect(cookieFor('development').read(requestWith(undefined))).toBeUndefined();
	});

	it('sets the token httpOnly, lax and scoped to /auth', () => {
		const { response, cookie } = responseSpy();
		const expires = new Date('2026-09-01T00:00:00.000Z');

		cookieFor('development').set(response, 'the-token', expires);

		expect(cookie).toHaveBeenCalledWith(REFRESH_COOKIE, 'the-token', {
			httpOnly: true,
			secure: false,
			sameSite: 'lax',
			path: '/auth',
			expires,
		});
	});

	it('marks the cookie secure only in production', () => {
		const { response, cookie } = responseSpy();
		cookieFor('production').set(response, 'the-token', new Date());

		expect(cookie.mock.calls[0]?.[2]).toMatchObject({ secure: true });
	});

	it('clears with exactly the options it set, so the browser matches the cookie', () => {
		const { response, cookie, clear } = responseSpy();
		const subject = cookieFor('production');

		subject.set(response, 'the-token', new Date());
		subject.clear(response);

		const { expires: _expires, ...setOptions } = cookie.mock.calls[0]?.[2] as Record<string, unknown>;
		expect(clear).toHaveBeenCalledWith(REFRESH_COOKIE, setOptions);
	});
});
