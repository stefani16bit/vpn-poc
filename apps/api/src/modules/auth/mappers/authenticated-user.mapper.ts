import type { AuthenticatedUser } from '@vpn/contracts';

import type { User } from '../../../shared/identity/user.js';
import { localeOf } from '../../../shared/locale/user-locale.js';

export function toAuthenticatedUser(user: User): AuthenticatedUser {
	return {
		id: user.id,
		accountId: user.accountId,
		role: user.role,
		email: user.email,
		emailVerified: user.emailVerifiedAt !== null,
		locale: localeOf(user),
		createdAt: user.createdAt.toISOString(),
	};
}
