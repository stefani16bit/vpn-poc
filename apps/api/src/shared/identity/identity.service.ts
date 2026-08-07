import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { ENV, hashToken } from '@vpn-poc/adapters';
import type { Env } from '@vpn-poc/env';
import { CLOCK, PASSWORD_HASHER, type IClock, type IPasswordHasher } from '@vpn/ports';

import type { Executor } from '../database/transaction-runner.js';
import { AccountRepository } from './repositories/account.repository.js';
import { UserRepository } from './repositories/user.repository.js';
import { SessionRepository } from './repositories/session.repository.js';
import { decideRotation, type LockedRotation } from './session-rotation.js';
import { deriveSlug, slugCandidate } from './slug.js';
import type { RefreshOutcome, RegisterOutcome, Session, User } from './user.js';

const ABSENT_USER_HASH =
	'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const REFRESH_TOKEN_BYTES = 32;
const SLUG_ATTEMPTS = 25;

@Injectable()
export class IdentityService {
	readonly #refreshTtlSeconds: number;

	constructor(
		@Inject(ENV) env: Env,
		@Inject(CLOCK) private readonly clock: IClock,
		@Inject(PASSWORD_HASHER) private readonly hasher: IPasswordHasher,
		private readonly accounts: AccountRepository,
		private readonly users: UserRepository,
		private readonly sessions: SessionRepository,
	) {
		this.#refreshTtlSeconds = env.AUTH_REFRESH_TOKEN_TTL;
	}

	async register(
		email: string,
		password: string,
		locale: string,
		executor?: Executor,
	): Promise<RegisterOutcome> {
		const normalized = normalizeEmail(email);
		const passwordHash = await this.hasher.hash(password);

		const account = await this.#claimAccount(normalized, executor);
		if (!account) throw new Error('exhausted slug candidates');

		const stored = await this.users.insert(
			{
				accountId: account.id,
				email: normalized,
				passwordHash,
				role: 'owner',
				locale,
			},
			executor,
		);

		if (!stored) return { kind: 'email_taken' };
		return { kind: 'registered', user: toUser(stored) };
	}

	async authenticate(email: string, password: string, slug?: string): Promise<User | null> {
		const normalized = normalizeEmail(email);
		const stored = slug
			? await this.#byAccountSlug(slug, normalized)
			: await this.users.findByEmail(normalized);

		if (!stored) {
			await this.hasher.verify(password, ABSENT_USER_HASH);
			return null;
		}

		if (!(await this.hasher.verify(password, stored.passwordHash))) return null;

		if (this.hasher.needsRehash(stored.passwordHash)) {
			const upgraded = await this.hasher.hash(password);
			await this.users.updatePasswordHash(stored.id, upgraded, this.clock.now());
		}

		return toUser(stored);
	}

	async findByEmail(email: string): Promise<User | null> {
		const stored = await this.users.findByEmail(normalizeEmail(email));
		return stored ? toUser(stored) : null;
	}

	async findById(userId: string): Promise<User | null> {
		const stored = await this.users.findById(userId);
		return stored ? toUser(stored) : null;
	}

	async startSession(user: Pick<User, 'id' | 'accountId'>): Promise<Session> {
		const familyId = await this.sessions.createFamily({
			userId: user.id,
			accountId: user.accountId,
		});

		return this.#issue(familyId, user.id, user.accountId);
	}

	async lockRotation(
		refreshToken: string,
		executor: Executor,
	): Promise<LockedRotation | undefined> {
		const tokenHash = hashToken(refreshToken);
		const candidate = await this.sessions.lockByTokenHash(tokenHash, executor);

		return candidate && { ...candidate, tokenHash };
	}

	async rotateSession(locked: LockedRotation, executor: Executor): Promise<RefreshOutcome> {
		const decision = decideRotation(locked, this.clock.now());

		if (decision.kind === 'reject') return { kind: 'rejected' };

		if (decision.kind === 'revoke_family') {
			await this.sessions.revokeFamily(decision.familyId, this.clock.now(), executor);
			return { kind: 'reuse_detected', sessionId: decision.familyId };
		}

		const spent = await this.sessions.spendToken(locked.tokenHash, this.clock.now(), executor);
		if (!spent) return { kind: 'rejected' };

		return {
			kind: 'rotated',
			session: await this.#issue(decision.familyId, decision.userId, decision.accountId, executor),
		};
	}

	async revokeSession(refreshToken: string): Promise<void> {
		const familyId = await this.sessions.familyIdByTokenHash(hashToken(refreshToken));
		if (!familyId) return;

		await this.sessions.revokeFamily(familyId, this.clock.now());
	}

	async revokeAllSessions(userId: string): Promise<void> {
		await this.sessions.revokeAllForUser(userId, this.clock.now());
	}

	async markEmailVerified(userId: string, executor?: Executor): Promise<void> {
		await this.users.markEmailVerified(userId, this.clock.now(), executor);
	}

	async setLocale(userId: string, locale: string, executor?: Executor): Promise<void> {
		await this.users.setLocale(userId, locale, this.clock.now(), executor);
	}

	async changePassword(userId: string, newPassword: string, executor?: Executor): Promise<void> {
		const passwordHash = await this.hasher.hash(newPassword);

		await this.users.updatePasswordHash(userId, passwordHash, this.clock.now(), executor);
		await this.sessions.revokeAllForUser(userId, this.clock.now(), executor);
	}

	async #byAccountSlug(slug: string, email: string) {
		const account = await this.accounts.findBySlug(slug);
		if (!account) return undefined;

		return this.users.findByAccountAndEmail(account.id, email);
	}

	async #claimAccount(email: string, executor?: Executor) {
		const base = deriveSlug(email);

		for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
			const slug = slugCandidate(base, attempt);
			const account = await this.accounts.claimSlug({ slug, name: base }, executor);
			if (account) return account;
		}

		return undefined;
	}

	async #issue(
		familyId: string,
		userId: string,
		accountId: string,
		executor?: Executor,
	): Promise<Session> {
		const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
		const expiresAt = new Date(this.clock.now().getTime() + this.#refreshTtlSeconds * 1000);

		await this.sessions.insertToken(
			{ tokenHash: hashToken(refreshToken), familyId, accountId, expiresAt },
			executor,
		);

		return { userId, accountId, sessionId: familyId, refreshToken, expiresAt };
	}
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

function toUser(stored: User): User {
	return {
		id: stored.id,
		accountId: stored.accountId,
		email: stored.email,
		role: stored.role,
		emailVerifiedAt: stored.emailVerifiedAt,
		locale: stored.locale,
		createdAt: stored.createdAt,
	};
}
