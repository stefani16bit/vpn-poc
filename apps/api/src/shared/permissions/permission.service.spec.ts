import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ICacheStore } from '@vpn/ports';

import { runInScope } from '../database/db-scope.js';
import type { Executor, TransactionRunner } from '../database/transaction-runner.js';
import type { PermissionRepository } from './repositories/permission.repository.js';
import { PermissionService, permissionCacheKey } from './permission.service.js';

const ACCOUNT = 'acc-1';
const ANA = 'user-ana';
const BRUNO = 'user-bruno';
const EXECUTOR = Symbol('executor') as unknown as Executor;
const KEY = { owner: ACCOUNT, namespace: 'permissions', id: 'grants' };

const EMPTY = { roles: [], users: [] };

describe('PermissionService', () => {
	let cache: {
		get: ReturnType<typeof vi.fn>;
		set: ReturnType<typeof vi.fn>;
		delete: ReturnType<typeof vi.fn>;
		increment: ReturnType<typeof vi.fn>;
	};
	let grants: { findByAccount: ReturnType<typeof vi.fn> };
	let transactions: { runInAccount: ReturnType<typeof vi.fn> };
	let service: PermissionService;

	beforeEach(() => {
		cache = {
			get: vi.fn().mockResolvedValue(null),
			set: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined),
			increment: vi.fn(),
		};
		grants = { findByAccount: vi.fn().mockResolvedValue(EMPTY) };
		transactions = {
			runInAccount: vi.fn((_accountId: string, work: (executor: Executor) => Promise<unknown>) =>
				work(EXECUTOR),
			),
		};

		service = new PermissionService(
			cache as unknown as ICacheStore,
			grants as unknown as PermissionRepository,
			transactions as unknown as TransactionRunner,
		);
	});

	it('keys one entry per account, so editing a role invalidates everyone at once', () => {
		expect(permissionCacheKey(ACCOUNT)).toEqual(KEY);
		expect(permissionCacheKey('acc-2').owner).toBe('acc-2');
	});

	describe('with a warm cache', () => {
		it('resolves without reading the tables', async () => {
			cache.get.mockResolvedValue(EMPTY);

			expect(await service.forUser(ACCOUNT, ANA, 'member')).toEqual(['devices.create']);
			expect(grants.findByAccount).not.toHaveBeenCalled();
			expect(transactions.runInAccount).not.toHaveBeenCalled();
		});

		it('treats an account with no grant at all as a hit, not as a miss', async () => {
			cache.get.mockResolvedValue(EMPTY);
			await service.forUser(ACCOUNT, ANA, 'member');

			expect(cache.set).not.toHaveBeenCalled();
		});
	});

	describe('with a cold cache', () => {
		it('stores the raw grants of the account, not the resolved set of a person', async () => {
			const stored = {
				roles: [{ role: 'member', permission: 'devices.create', granted: false }],
				users: [],
			};
			grants.findByAccount.mockResolvedValue(stored);

			await service.forUser(ACCOUNT, ANA, 'member');

			expect(cache.set).toHaveBeenCalledWith(KEY, stored, 60);
		});

		it('opens its own transaction when it runs ahead of the request one', async () => {
			await service.forUser(ACCOUNT, ANA, 'member');

			expect(transactions.runInAccount).toHaveBeenCalledTimes(1);
			expect(transactions.runInAccount.mock.calls[0]?.[0]).toBe(ACCOUNT);
			expect(grants.findByAccount).toHaveBeenCalledWith(ACCOUNT, EXECUTOR);
		});

		it('joins the request transaction instead of opening a second one', async () => {
			await runInScope(EXECUTOR, () => service.forUser(ACCOUNT, ANA, 'member'));

			expect(transactions.runInAccount).not.toHaveBeenCalled();
			expect(grants.findByAccount).toHaveBeenCalledWith(ACCOUNT, EXECUTOR);
		});
	});

	describe('resolution', () => {
		it('hands an untouched account exactly the code default', async () => {
			expect(await service.forUser(ACCOUNT, ANA, 'member')).toEqual(['devices.create']);
			expect(await service.forUser(ACCOUNT, ANA, 'admin')).toContain('users.create');
		});

		it('lets the account take the only default a member has', async () => {
			grants.findByAccount.mockResolvedValue({
				roles: [{ role: 'member', permission: 'devices.create', granted: false }],
				users: [],
			});

			expect(await service.forUser(ACCOUNT, ANA, 'member')).toEqual([]);
		});

		it('applies a grant only to the role it was written for', async () => {
			grants.findByAccount.mockResolvedValue({
				roles: [{ role: 'admin', permission: 'billing.manage', granted: true }],
				users: [],
			});

			expect(await service.forUser(ACCOUNT, ANA, 'admin')).toContain('billing.manage');
			expect(await service.forUser(ACCOUNT, BRUNO, 'member')).not.toContain('billing.manage');
		});

		it('separates two people who share a role', async () => {
			grants.findByAccount.mockResolvedValue({
				roles: [{ role: 'member', permission: 'devices.create', granted: false }],
				users: [{ userId: ANA, permission: 'devices.create', granted: true }],
			});

			expect(await service.forUser(ACCOUNT, ANA, 'member')).toEqual(['devices.create']);
			expect(await service.forUser(ACCOUNT, BRUNO, 'member')).toEqual([]);
		});

		it('never lets the owner lose the permission that edits permissions', async () => {
			grants.findByAccount.mockResolvedValue({
				roles: [{ role: 'owner', permission: 'permissions.manage', granted: false }],
				users: [{ userId: ANA, permission: 'permissions.manage', granted: false }],
			});

			expect(await service.forUser(ACCOUNT, ANA, 'owner')).toContain('permissions.manage');
		});
	});

	describe('has', () => {
		it('answers the guard without making it know about resolution', async () => {
			expect(await service.has(ACCOUNT, ANA, 'member', 'devices.create')).toBe(true);
			expect(await service.has(ACCOUNT, ANA, 'member', 'billing.manage')).toBe(false);
		});
	});

	describe('invalidate', () => {
		it('drops exactly the entry the reader would have found', async () => {
			await service.invalidate(ACCOUNT);

			expect(cache.delete).toHaveBeenCalledWith(KEY);
		});
	});
});
