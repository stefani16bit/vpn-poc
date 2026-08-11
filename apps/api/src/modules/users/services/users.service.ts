import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { AccountUser, CreateUserRequest, CreateUserResponse } from '@vpn/contracts';
import { CLOCK, PASSWORD_HASHER, type IClock, type IPasswordHasher } from '@vpn/ports';

import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import { isRestrictViolation, isUniqueViolation } from '../../../shared/database/pg-errors.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { SessionRepository } from '../../../shared/identity/repositories/session.repository.js';
import {
	UserRepository,
	type AccountMember,
} from '../../../shared/identity/repositories/user.repository.js';
import type { UserRole } from '../../../shared/identity/user.js';
import { localeOf } from '../../../shared/locale/user-locale.js';

const ACCOUNT_EMAIL_INDEX = 'users_account_email_key';
const TEMPORARY_PASSWORD_BYTES = 32;

@Injectable()
export class UsersService {
	constructor(
		private readonly users: UserRepository,
		private readonly sessions: SessionRepository,
		@Inject(PASSWORD_HASHER) private readonly hasher: IPasswordHasher,
		@Inject(CLOCK) private readonly clock: IClock,
	) {}

	async list(claims: AccessTokenClaims): Promise<{ users: AccountUser[] }> {
		const members = await this.users.listByAccount(claims.accountId);

		return { users: members.map(toView) };
	}

	async create(claims: AccessTokenClaims, request: CreateUserRequest): Promise<CreateUserResponse> {
		const temporaryPassword = randomBytes(TEMPORARY_PASSWORD_BYTES).toString('base64url');
		const now = this.clock.now();

		const created = await this.#insert({
			accountId: claims.accountId,
			email: request.email,
			passwordHash: await this.hasher.hash(temporaryPassword),
			role: request.role,
			locale: request.locale ?? 'pt-BR',
			emailVerifiedAt: now,
		});

		if (!created) {
			throw new AppError('CONFLICT', 'this email already belongs to a user of this account');
		}

		return {
			user: toView({ ...created, liveDeviceCount: 0 }),
			temporaryPassword,
		};
	}

	async changeRole(
		claims: AccessTokenClaims,
		userId: string,
		role: UserRole,
	): Promise<{ user: AccountUser }> {
		const target = await this.#target(claims, userId);

		await this.users.updateRole(userId, role, this.clock.now());
		await this.sessions.revokeAllForUser(userId, this.clock.now());

		return { user: toView({ ...target, role }) };
	}

	async remove(claims: AccessTokenClaims, userId: string): Promise<void> {
		await this.#target(claims, userId);
		await this.sessions.revokeAllForUser(userId, this.clock.now());

		try {
			await this.users.deleteById(userId);
		} catch (error: unknown) {
			if (isRestrictViolation(error)) {
				throw new AppError('CONFLICT', 'revoke the devices of this user before removing them');
			}

			throw error;
		}
	}

	async #insert(values: {
		accountId: string;
		email: string;
		passwordHash: string;
		role: UserRole;
		locale: string;
		emailVerifiedAt: Date;
	}) {
		try {
			return await this.users.insertMember(values);
		} catch (error: unknown) {
			if (isUniqueViolation(error, ACCOUNT_EMAIL_INDEX)) return undefined;

			throw error;
		}
	}

	async #target(claims: AccessTokenClaims, userId: string): Promise<AccountMember> {
		if (userId === claims.userId) {
			throw new AppError('FORBIDDEN', 'a user cannot change or remove themselves');
		}

		const members = await this.users.listByAccount(claims.accountId);
		const target = members.find((member) => member.id === userId);

		if (!target) throw new AppError('NOT_FOUND', 'no user with that id in this account');
		if (target.role === 'owner') {
			throw new AppError('FORBIDDEN', 'the owner of an account cannot be changed or removed');
		}

		return target;
	}
}

function toView(member: {
	id: string;
	email: string;
	role: UserRole;
	emailVerifiedAt: Date | null;
	locale: string;
	createdAt: Date;
	liveDeviceCount: number;
}): AccountUser {
	return {
		id: member.id,
		email: member.email,
		role: member.role,
		emailVerified: member.emailVerifiedAt !== null,
		locale: localeOf(member),
		liveDeviceCount: member.liveDeviceCount,
		createdAt: member.createdAt.toISOString(),
	};
}
