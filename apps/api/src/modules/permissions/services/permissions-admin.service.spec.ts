import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '../../../shared/errors/app-error.js';
import type { UserRepository } from '../../../shared/identity/repositories/user.repository.js';
import type { PermissionService } from '../../../shared/permissions/permission.service.js';
import type { PermissionRepository } from '../../../shared/permissions/repositories/permission.repository.js';
import { PermissionsAdminService } from './permissions-admin.service.js';

const ACCOUNT = 'acc-1';
const ANA = 'user-ana';

const NO_GRANTS = { roles: [], users: [] };

async function codeOf(run: Promise<unknown>): Promise<string> {
	try {
		await run;
		expect.unreachable('should have thrown');
	} catch (error) {
		expect(error).toBeInstanceOf(AppError);
		return (error as AppError).code;
	}
}

describe('PermissionsAdminService', () => {
	let grants: {
		setRoleGrant: ReturnType<typeof vi.fn>;
		clearRoleGrant: ReturnType<typeof vi.fn>;
		setUserGrant: ReturnType<typeof vi.fn>;
		clearUserGrant: ReturnType<typeof vi.fn>;
	};
	let permissions: { grantsOf: ReturnType<typeof vi.fn>; invalidate: ReturnType<typeof vi.fn> };
	let users: { findById: ReturnType<typeof vi.fn>; listByAccount: ReturnType<typeof vi.fn> };
	let admin: PermissionsAdminService;

	beforeEach(() => {
		grants = {
			setRoleGrant: vi.fn().mockResolvedValue(undefined),
			clearRoleGrant: vi.fn().mockResolvedValue(undefined),
			setUserGrant: vi.fn().mockResolvedValue(undefined),
			clearUserGrant: vi.fn().mockResolvedValue(undefined),
		};
		permissions = {
			grantsOf: vi.fn().mockResolvedValue(NO_GRANTS),
			invalidate: vi.fn().mockResolvedValue(undefined),
		};
		users = {
			findById: vi.fn().mockResolvedValue({ id: ANA, accountId: ACCOUNT, role: 'member' }),
			listByAccount: vi.fn().mockResolvedValue([
				{ id: 'user-owner', email: 'owner@example.com', role: 'owner' },
				{ id: ANA, email: 'ana@example.com', role: 'member' },
			]),
		};

		admin = new PermissionsAdminService(
			grants as unknown as PermissionRepository,
			permissions as unknown as PermissionService,
			users as unknown as UserRepository,
		);
	});

	describe('overview', () => {
		it('leaves the owner out, because none of it can be edited', async () => {
			const overview = await admin.overview(ACCOUNT);

			expect(overview.roles.map((entry) => entry.role)).toEqual(['admin', 'member']);
		});

		it('leaves the owner out of the per-person list, which can never be locked out', async () => {
			expect((await admin.overview(ACCOUNT)).users.map((entry) => entry.userId)).toEqual([ANA]);
		});

		it('sends the default next to the effective set, which is what marks a change', async () => {
			permissions.grantsOf.mockResolvedValue({
				roles: [{ role: 'member', permission: 'devices.create', granted: false }],
				users: [],
			});

			const member = (await admin.overview(ACCOUNT)).roles.find((entry) => entry.role === 'member');

			expect(member?.defaults).toEqual(['devices.create']);
			expect(member?.effective).toEqual([]);
			expect(member?.grants).toEqual([{ permission: 'devices.create', granted: false }]);
		});

		it('groups the exceptions by person', async () => {
			permissions.grantsOf.mockResolvedValue({
				roles: [],
				users: [
					{ userId: ANA, permission: 'devices.create', granted: true },
					{ userId: ANA, permission: 'users.read', granted: false },
				],
			});

			expect((await admin.overview(ACCOUNT)).users).toEqual([
				{
					userId: ANA,
					email: 'ana@example.com',
					role: 'member',
					grants: [
						{ permission: 'devices.create', granted: true },
						{ permission: 'users.read', granted: false },
					],
				},
			]);
		});

		it('drops a stored row the code no longer names, rather than serving it to a screen', async () => {
			permissions.grantsOf.mockResolvedValue({
				roles: [{ role: 'member', permission: 'devices.teleport', granted: true }],
				users: [{ userId: ANA, permission: 'devices.teleport', granted: true }],
			});

			const overview = await admin.overview(ACCOUNT);

			expect(overview.roles.find((entry) => entry.role === 'member')?.grants).toEqual([]);
			expect(overview.users).toEqual([
				{ userId: ANA, email: 'ana@example.com', role: 'member', grants: [] },
			]);
		});
	});

	describe('setRoleGrant', () => {
		it('stores the row when the answer diverges from the default', async () => {
			await admin.setRoleGrant(ACCOUNT, 'member', {
				permission: 'devices.create',
				granted: false,
			});

			expect(grants.setRoleGrant).toHaveBeenCalledWith(ACCOUNT, 'member', 'devices.create', false);
			expect(grants.clearRoleGrant).not.toHaveBeenCalled();
		});

		it('drops the row when the answer agrees with it again', async () => {
			await admin.setRoleGrant(ACCOUNT, 'member', { permission: 'devices.create', granted: true });

			expect(grants.clearRoleGrant).toHaveBeenCalledWith(ACCOUNT, 'member', 'devices.create');
			expect(grants.setRoleGrant).not.toHaveBeenCalled();
		});

		it('refuses to write against the owner, which holds every permission by construction', async () => {
			expect(
				await codeOf(
					admin.setRoleGrant(ACCOUNT, 'owner', { permission: 'billing.manage', granted: false }),
				),
			).toBe('FORBIDDEN');
			expect(grants.setRoleGrant).not.toHaveBeenCalled();
			expect(grants.clearRoleGrant).not.toHaveBeenCalled();
		});

		it('invalidates before answering, so the screen never shows the value it replaced', async () => {
			await admin.setRoleGrant(ACCOUNT, 'admin', { permission: 'billing.manage', granted: true });

			expect(permissions.invalidate).toHaveBeenCalledWith(ACCOUNT);
			expect(permissions.invalidate.mock.invocationCallOrder[0]).toBeLessThan(
				permissions.grantsOf.mock.invocationCallOrder.at(-1) ?? 0,
			);
		});
	});

	describe('setUserGrant', () => {
		it('stores the row when the person diverges from what the role gives them', async () => {
			permissions.grantsOf.mockResolvedValue({
				roles: [{ role: 'member', permission: 'devices.create', granted: false }],
				users: [],
			});

			await admin.setUserGrant(ACCOUNT, ANA, { permission: 'devices.create', granted: true });

			expect(grants.setUserGrant).toHaveBeenCalledWith(ACCOUNT, ANA, 'devices.create', true);
		});

		it('drops the row when the person falls back in line with the role', async () => {
			await admin.setUserGrant(ACCOUNT, ANA, { permission: 'devices.create', granted: true });

			expect(grants.clearUserGrant).toHaveBeenCalledWith(ACCOUNT, ANA, 'devices.create');
			expect(grants.setUserGrant).not.toHaveBeenCalled();
		});

		it('measures against the role alone, not against what the person already had', async () => {
			permissions.grantsOf.mockResolvedValue({
				roles: [],
				users: [{ userId: ANA, permission: 'devices.create', granted: false }],
			});

			await admin.setUserGrant(ACCOUNT, ANA, { permission: 'devices.create', granted: true });

			expect(grants.clearUserGrant).toHaveBeenCalledWith(ACCOUNT, ANA, 'devices.create');
		});

		it('refuses an exception against the owner, by the same rule as the role', async () => {
			users.findById.mockResolvedValue({ id: 'user-owner', accountId: ACCOUNT, role: 'owner' });

			expect(
				await codeOf(
					admin.setUserGrant(ACCOUNT, 'user-owner', {
						permission: 'billing.manage',
						granted: false,
					}),
				),
			).toBe('FORBIDDEN');
			expect(grants.setUserGrant).not.toHaveBeenCalled();
			expect(grants.clearUserGrant).not.toHaveBeenCalled();
		});

		it('refuses a user id from another account, which the policy would hide anyway', async () => {
			users.findById.mockResolvedValue({ id: ANA, accountId: 'acc-2', role: 'member' });

			expect(
				await codeOf(
					admin.setUserGrant(ACCOUNT, ANA, { permission: 'devices.create', granted: true }),
				),
			).toBe('NOT_FOUND');
			expect(grants.setUserGrant).not.toHaveBeenCalled();
		});

		it('refuses a user id that matches nobody', async () => {
			users.findById.mockResolvedValue(undefined);

			expect(
				await codeOf(
					admin.setUserGrant(ACCOUNT, ANA, { permission: 'devices.create', granted: true }),
				),
			).toBe('NOT_FOUND');
		});
	});
});
