import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

import type { Env } from '@vpn-poc/env';
import {
	CLOCK,
	SECRET_STORE,
	type IClock,
	type ISecretStore,
	type SecretVersions,
} from '@vpn/ports';

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
export class AccessTokenService implements OnModuleInit {
	readonly #ref: string;
	readonly #ttlSeconds: number;
	readonly #clock: IClock;
	readonly #secrets: ISecretStore;

	constructor(
		@Inject(ENV) env: Env,
		@Inject(CLOCK) clock: IClock,
		@Inject(SECRET_STORE) secrets: ISecretStore,
	) {
		this.#ref = env.AUTH_JWT_SECRET_REF;
		this.#ttlSeconds = env.AUTH_ACCESS_TOKEN_TTL;
		this.#clock = clock;
		this.#secrets = secrets;
	}

	// A secret nobody created is a boot failure, not a 500 on the first login.
	// The store caches, so this costs one round trip and warms what issue() and
	// verify() go on to read.
	async onModuleInit(): Promise<void> {
		await this.#versions();
	}

	get ttlSeconds(): number {
		return this.#ttlSeconds;
	}

	async issue(claims: AccessTokenClaims): Promise<string> {
		const issuedAt = Math.floor(this.#clock.now().getTime() / 1000);
		const { current } = await this.#versions();

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
			.sign(keyOf(current));
	}

	async verify(token: string): Promise<AccessTokenClaims> {
		const { current, previous } = await this.#versions();

		try {
			const payload = await this.#payloadOf(
				token,
				previous === null ? [current] : [current, previous],
			);

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
			const expired = isExpired(error);
			throw new AppError(
				expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
				expired ? 'access token has expired' : 'access token is not valid',
			);
		}
	}

	// Every candidate goes through the same jwtVerify, issuer and audience
	// included. A fallback that only re-checks the signature would accept a token
	// minted by anything sharing the retired secret, and nothing would go red.
	async #payloadOf(token: string, secrets: readonly string[]): Promise<JWTPayload> {
		let lastError: unknown;

		for (const secret of secrets) {
			try {
				return (
					await jwtVerify(token, keyOf(secret), {
						issuer: ISSUER,
						audience: AUDIENCE,
						algorithms: ['HS256'],
					})
				).payload;
			} catch (error) {
				// Expiry does not depend on which key signed it, and trying the next
				// one turns the honest "your session ran out" into "your token is not
				// valid" — the one message that sends a user to support.
				if (isExpired(error)) throw error;
				lastError = error;
			}
		}

		throw lastError;
	}

	async #versions(): Promise<SecretVersions> {
		const versions = await this.#secrets.read(this.#ref);
		if (!versions) {
			throw new AppError('INTERNAL', `no access token signing secret is stored at ${this.#ref}`);
		}

		return versions;
	}
}

function keyOf(secret: string): Uint8Array {
	return new TextEncoder().encode(secret);
}

function isExpired(error: unknown): boolean {
	return (error as { code?: string }).code === 'ERR_JWT_EXPIRED';
}

function isUserRole(value: unknown): value is UserRole {
	return value === 'owner' || value === 'admin' || value === 'member';
}
