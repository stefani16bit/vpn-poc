import { Inject, Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';

import type { Env } from '@vpn-poc/env';
import { CLOCK, type IClock } from '@vpn/ports';

import { ENV } from '@vpn-poc/adapters';
import { AppError } from '../errors/app-error.js';
import type { UserRole } from '../identity/user.js';

const ISSUER = 'poc-vpn';
const AUDIENCE = 'poc-vpn-api';

export interface AccessTokenClaims {
	readonly userId: string;
	readonly accountId: string;
	readonly role: UserRole;
	readonly sessionId: string;
	readonly emailVerified: boolean;
}

@Injectable()
export class AccessTokenService {
	readonly #secret: Uint8Array;
	readonly #ttlSeconds: number;
	readonly #clock: IClock;

	constructor(@Inject(ENV) env: Env, @Inject(CLOCK) clock: IClock) {
		this.#secret = new TextEncoder().encode(env.AUTH_JWT_SECRET);
		this.#ttlSeconds = env.AUTH_ACCESS_TOKEN_TTL;
		this.#clock = clock;
	}

	get ttlSeconds(): number {
		return this.#ttlSeconds;
	}

	async issue(claims: AccessTokenClaims): Promise<string> {
		const issuedAt = Math.floor(this.#clock.now().getTime() / 1000);

		return new SignJWT({
			sid: claims.sessionId,
			ev: claims.emailVerified,
			acc: claims.accountId,
			rol: claims.role,
		})
			.setProtectedHeader({ alg: 'HS256' })
			.setSubject(claims.userId)
			.setIssuer(ISSUER)
			.setAudience(AUDIENCE)
			.setIssuedAt(issuedAt)
			.setExpirationTime(issuedAt + this.#ttlSeconds)
			.sign(this.#secret);
	}

	async verify(token: string): Promise<AccessTokenClaims> {
		try {
			const { payload } = await jwtVerify(token, this.#secret, {
				issuer: ISSUER,
				audience: AUDIENCE,
				algorithms: ['HS256'],
			});

			if (!payload.sub || typeof payload['sid'] !== 'string') {
				throw new AppError('TOKEN_INVALID', 'access token is missing required claims');
			}

			if (typeof payload['acc'] !== 'string' || !isUserRole(payload['rol'])) {
				throw new AppError('TOKEN_INVALID', 'access token is missing tenancy claims');
			}

			return {
				userId: payload.sub,
				accountId: payload['acc'],
				role: payload['rol'],
				sessionId: payload['sid'],
				emailVerified: payload['ev'] === true,
			};
		} catch (error) {
			if (error instanceof AppError) throw error;
			const expired = (error as { code?: string }).code === 'ERR_JWT_EXPIRED';
			throw new AppError(
				expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
				expired ? 'access token has expired' : 'access token is not valid',
			);
		}
	}
}

function isUserRole(value: unknown): value is UserRole {
	return value === 'owner' || value === 'admin' || value === 'member';
}
