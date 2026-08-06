import type { AuthenticatedUser } from '@vpn/contracts';
import type { Account } from '@vpn/ports';

import { localeOf } from '../../../shared/locale/account-locale.js';

export function toAuthenticatedUser(account: Account): AuthenticatedUser {
	return {
		id: account.id,
		email: account.email,
		emailVerified: account.emailVerifiedAt !== null,
		locale: localeOf(account),
		createdAt: account.createdAt.toISOString(),
	};
}
