import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AccessTokenClaims } from '../../../shared/access-control/access-token.service.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { PermissionService } from '../../../shared/permissions/permission.service.js';
import type { PermissionsAdminService } from '../services/permissions-admin.service.js';
import { PermissionsController } from './permissions.controller.js';

const CLAIMS: AccessTokenClaims = {
	userId: 'user-1',
	accountId: 'acc-1',
	role: 'member',
	sessionId: 'sess-1',
	emailVerified: true,
};

const OVERVIEW = { roles: [], users: [] };

async function codeOf(run: Promise<unknown>): Promise<string> {
	try {
		await run;
		expect.unreachable('should have thrown');
	} catch (error) {
		expect(error).toBeInstanceOf(AppError);
		return (error as AppError).code;
	}
}

describe('PermissionsController', () => {
	let permissions: { forUser: ReturnType<typeof vi.fn> };
	let admin: {
		overview: ReturnType<typeof vi.fn>;
		setRoleGrant: ReturnType<typeof vi.fn>;
		setUserGrant: ReturnType<typeof vi.fn>;
	};
	let controller: PermissionsController;

	beforeEach(() => {
		permissions = { forUser: vi.fn().mockResolvedValue(['devices.create']) };
		admin = {
			overview: vi.fn().mockResolvedValue(OVERVIEW),
			setRoleGrant: vi.fn().mockResolvedValue(OVERVIEW),
			setUserGrant: vi.fn().mockResolvedValue(OVERVIEW),
		};

		controller = new PermissionsController(
			permissions as unknown as PermissionService,
			admin as unknown as PermissionsAdminService,
		);
	});

	it('answers for the caller in the token and never for an id it was handed', async () => {
		expect(await controller.mine(CLAIMS)).toEqual({ permissions: ['devices.create'] });
		expect(permissions.forUser).toHaveBeenCalledWith('acc-1', 'user-1', 'member');
	});

	it('reads the grants of the account in the token', async () => {
		expect(await controller.grants(CLAIMS)).toEqual(OVERVIEW);
		expect(admin.overview).toHaveBeenCalledWith('acc-1');
	});

	it('passes a role the enum knows straight through', async () => {
		const grant = { permission: 'devices.create' as const, granted: false };

		expect(await controller.setRoleGrant(CLAIMS, 'member', grant)).toEqual(OVERVIEW);
		expect(admin.setRoleGrant).toHaveBeenCalledWith('acc-1', 'member', grant);
	});

	it('refuses a role name the enum does not have, rather than writing an orphan row', async () => {
		const grant = { permission: 'devices.create' as const, granted: false };

		expect(await codeOf(controller.setRoleGrant(CLAIMS, 'superuser', grant))).toBe('NOT_FOUND');
		expect(admin.setRoleGrant).not.toHaveBeenCalled();
	});

	it('scopes a per-person grant to the account in the token, not to one in the path', async () => {
		const grant = { permission: 'devices.create' as const, granted: true };

		expect(await controller.setUserGrant(CLAIMS, 'user-ana', grant)).toEqual(OVERVIEW);
		expect(admin.setUserGrant).toHaveBeenCalledWith('acc-1', 'user-ana', grant);
	});
});
