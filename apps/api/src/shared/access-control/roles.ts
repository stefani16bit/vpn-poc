import type { UserRole } from '../identity/user.js';

const RANK: Readonly<Record<UserRole, number>> = {
	member: 0,
	admin: 1,
	owner: 2,
};

export function hasAtLeastRole(role: UserRole, minimum: UserRole): boolean {
	return RANK[role] >= RANK[minimum];
}
