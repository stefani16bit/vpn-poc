import { Inject, Injectable } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';

import { ENV } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';

export const REFRESH_COOKIE = 'poc_vpn_refresh';

@Injectable()
export class RefreshCookie {
	constructor(@Inject(ENV) private readonly env: Env) {}

	read(request: Request): string | undefined {
		return (request.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
	}

	set(response: Response, token: string, expiresAt: Date): void {
		response.cookie(REFRESH_COOKIE, token, { ...this.#options(), expires: expiresAt });
	}

	clear(response: Response): void {
		response.clearCookie(REFRESH_COOKIE, this.#options());
	}

	#options(): CookieOptions {
		return {
			httpOnly: true,
			secure: this.env.NODE_ENV === 'production',
			sameSite: 'lax',
			path: '/auth',
		};
	}
}
