import { createHash, randomBytes } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '@vpn-poc/database';
import { accounts, refreshTokens, sessionFamilies } from '@vpn-poc/database';
import type {
	Account,
	IClock,
	IIdentityProvider,
	IPasswordHasher,
	RefreshOutcome,
	RegisterOutcome,
	Session,
} from '@vpn/ports';

const ABSENT_ACCOUNT_HASH =
	'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export interface DrizzleIdentityProviderOptions {
	readonly refreshTokenTtlSeconds: number;
}

export class DrizzleIdentityProvider implements IIdentityProvider {
	readonly #db: Database;
	readonly #hasher: IPasswordHasher;
	readonly #clock: IClock;
	readonly #refreshTtlSeconds: number;

	constructor(
		db: Database,
		hasher: IPasswordHasher,
		clock: IClock,
		options: DrizzleIdentityProviderOptions,
	) {
		this.#db = db;
		this.#hasher = hasher;
		this.#clock = clock;
		this.#refreshTtlSeconds = options.refreshTokenTtlSeconds;
	}

	async register(email: string, password: string, locale: string): Promise<RegisterOutcome> {
		const normalized = normalizeEmail(email);
		const passwordHash = await this.#hasher.hash(password);

		const inserted = await this.#db
			.insert(accounts)
			.values({ email: normalized, passwordHash, locale })
			.onConflictDoNothing({ target: accounts.email })
			.returning();

		const row = inserted[0];
		if (!row) return { kind: 'email_taken' };
		return { kind: 'registered', account: toAccount(row) };
	}

	async authenticate(email: string, password: string): Promise<Account | null> {
		const row = await this.#rowByEmail(email);

		if (!row) {
			await this.#hasher.verify(password, ABSENT_ACCOUNT_HASH);
			return null;
		}

		if (!(await this.#hasher.verify(password, row.passwordHash))) return null;

		if (this.#hasher.needsRehash(row.passwordHash)) {
			const upgraded = await this.#hasher.hash(password);
			await this.#db
				.update(accounts)
				.set({ passwordHash: upgraded, updatedAt: this.#clock.now() })
				.where(eq(accounts.id, row.id));
		}

		return toAccount(row);
	}

	async findByEmail(email: string): Promise<Account | null> {
		const row = await this.#rowByEmail(email);
		return row ? toAccount(row) : null;
	}

	async findById(accountId: string): Promise<Account | null> {
		const rows = await this.#db.select().from(accounts).where(eq(accounts.id, accountId)).limit(1);
		const row = rows[0];
		return row ? toAccount(row) : null;
	}

	async startSession(accountId: string): Promise<Session> {
		const families = await this.#db.insert(sessionFamilies).values({ accountId }).returning();
		const family = families[0];
		if (!family) throw new Error('failed to create a session family');

		return this.#issue(family.id, accountId);
	}

	async refreshSession(refreshToken: string): Promise<RefreshOutcome> {
		const tokenHash = hashToken(refreshToken);

		const outcome = await this.#db.transaction(async (tx): Promise<RefreshOutcome> => {
			const rows = await tx
				.select({
					familyId: refreshTokens.familyId,
					spentAt: refreshTokens.spentAt,
					expiresAt: refreshTokens.expiresAt,
					accountId: sessionFamilies.accountId,
					revokedAt: sessionFamilies.revokedAt,
				})
				.from(refreshTokens)
				.innerJoin(sessionFamilies, eq(refreshTokens.familyId, sessionFamilies.id))
				.where(eq(refreshTokens.tokenHash, tokenHash))
				.for('update')
				.limit(1);

			const row = rows[0];
			if (!row) return { kind: 'rejected' };
			if (row.revokedAt !== null) return { kind: 'rejected' };

			if (row.spentAt !== null) {
				await tx
					.update(sessionFamilies)
					.set({ revokedAt: this.#clock.now() })
					.where(eq(sessionFamilies.id, row.familyId));
				return { kind: 'reuse_detected', sessionId: row.familyId };
			}

			if (row.expiresAt.getTime() <= this.#clock.now().getTime()) return { kind: 'rejected' };

			const spent = await tx
				.update(refreshTokens)
				.set({ spentAt: this.#clock.now() })
				.where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.spentAt)))
				.returning({ tokenHash: refreshTokens.tokenHash });

			if (spent.length === 0) return { kind: 'rejected' };

			return { kind: 'rotated', session: await this.#issue(row.familyId, row.accountId, tx) };
		});

		return outcome;
	}

	async revokeSession(refreshToken: string): Promise<void> {
		const rows = await this.#db
			.select({ familyId: refreshTokens.familyId })
			.from(refreshTokens)
			.where(eq(refreshTokens.tokenHash, hashToken(refreshToken)))
			.limit(1);

		const familyId = rows[0]?.familyId;
		if (!familyId) return;

		await this.#db
			.update(sessionFamilies)
			.set({ revokedAt: this.#clock.now() })
			.where(and(eq(sessionFamilies.id, familyId), isNull(sessionFamilies.revokedAt)));
	}

	async revokeAllSessions(accountId: string): Promise<void> {
		await this.#db
			.update(sessionFamilies)
			.set({ revokedAt: this.#clock.now() })
			.where(and(eq(sessionFamilies.accountId, accountId), isNull(sessionFamilies.revokedAt)));
	}

	async setLocale(accountId: string, locale: string): Promise<void> {
		await this.#db
			.update(accounts)
			.set({ locale, updatedAt: this.#clock.now() })
			.where(eq(accounts.id, accountId));
	}

	async markEmailVerified(accountId: string): Promise<void> {
		await this.#db
			.update(accounts)
			.set({ emailVerifiedAt: this.#clock.now(), updatedAt: this.#clock.now() })
			.where(and(eq(accounts.id, accountId), isNull(accounts.emailVerifiedAt)));
	}

	async changePassword(accountId: string, newPassword: string): Promise<void> {
		const passwordHash = await this.#hasher.hash(newPassword);
		await this.#db
			.update(accounts)
			.set({ passwordHash, updatedAt: this.#clock.now() })
			.where(eq(accounts.id, accountId));

		await this.revokeAllSessions(accountId);
	}

	async #rowByEmail(email: string) {
		const rows = await this.#db
			.select()
			.from(accounts)
			.where(eq(accounts.email, normalizeEmail(email)))
			.limit(1);
		return rows[0];
	}

	async #issue(
		familyId: string,
		accountId: string,
		tx: Pick<Database, 'insert'> = this.#db,
	): Promise<Session> {
		const refreshToken = randomBytes(32).toString('base64url');
		const expiresAt = new Date(this.#clock.now().getTime() + this.#refreshTtlSeconds * 1000);

		await tx.insert(refreshTokens).values({ tokenHash: hashToken(refreshToken), familyId, expiresAt });

		return { accountId, sessionId: familyId, refreshToken, expiresAt };
	}
}

function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

function toAccount(row: typeof accounts.$inferSelect): Account {
	return {
		id: row.id,
		email: row.email,
		emailVerifiedAt: row.emailVerifiedAt,
		locale: row.locale,
		createdAt: row.createdAt,
	};
}
