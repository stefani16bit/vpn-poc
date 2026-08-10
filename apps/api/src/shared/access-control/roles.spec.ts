import { describe, expect, it } from 'vitest';

import type { UserRole } from '../identity/user.js';
import { hasAtLeastRole } from './roles.js';

const ROLES: readonly UserRole[] = ['owner', 'admin', 'member'];

describe('hasAtLeastRole', () => {
	it('lets an owner do what an admin does', () => {
		expect(hasAtLeastRole('owner', 'admin')).toBe(true);
	});

	it('lets an admin do what an admin does', () => {
		expect(hasAtLeastRole('admin', 'admin')).toBe(true);
	});

	it('stops a member short of admin', () => {
		expect(hasAtLeastRole('member', 'admin')).toBe(false);
	});

	it('holds every role to the floor every role can reach', () => {
		for (const role of ROLES) {
			expect(hasAtLeastRole(role, 'member')).toBe(true);
		}
	});

	it('keeps owner alone at the top', () => {
		expect(hasAtLeastRole('admin', 'owner')).toBe(false);
		expect(hasAtLeastRole('member', 'owner')).toBe(false);
		expect(hasAtLeastRole('owner', 'owner')).toBe(true);
	});

	it('ranks every role the schema declares, so a new one cannot default to allowed', () => {
		for (const role of ROLES) {
			expect(hasAtLeastRole(role, role)).toBe(true);
		}
	});
});
