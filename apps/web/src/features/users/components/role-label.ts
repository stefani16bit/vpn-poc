import type { UserRole } from '@vpn/contracts';

export const ROLE_LABEL = {
	owner: 'users.roleOwner',
	admin: 'users.roleAdmin',
	member: 'users.roleMember',
} as const satisfies Record<UserRole, string>;
