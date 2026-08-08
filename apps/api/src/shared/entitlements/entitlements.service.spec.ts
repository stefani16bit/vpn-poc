import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ENTITLEMENTS, UNSUBSCRIBED_ENTITLEMENTS } from '@vpn/contracts';
import type { ICacheStore } from '@vpn/ports';

import { runInScope } from '../database/db-scope.js';
import type { Executor, TransactionRunner } from '../database/transaction-runner.js';
import type { SubscriptionRepository } from '../subscriptions/subscription.repository.js';
import { EntitlementsService, entitlementCacheKey } from './entitlements.service.js';

const ACCOUNT = 'acc-1';
const EXECUTOR = Symbol('executor') as unknown as Executor;
const KEY = { owner: ACCOUNT, namespace: 'entitlements', id: 'tier' };

describe('EntitlementsService', () => {
	let cache: {
		get: ReturnType<typeof vi.fn>;
		set: ReturnType<typeof vi.fn>;
		delete: ReturnType<typeof vi.fn>;
		increment: ReturnType<typeof vi.fn>;
	};
	let subscriptions: { findByAccount: ReturnType<typeof vi.fn> };
	let transactions: { runInAccount: ReturnType<typeof vi.fn> };
	let service: EntitlementsService;

	beforeEach(() => {
		cache = {
			get: vi.fn().mockResolvedValue(null),
			set: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined),
			increment: vi.fn(),
		};
		subscriptions = { findByAccount: vi.fn().mockResolvedValue(undefined) };
		transactions = {
			runInAccount: vi.fn((_accountId: string, work: (executor: Executor) => Promise<unknown>) =>
				work(EXECUTOR),
			),
		};

		service = new EntitlementsService(
			cache as unknown as ICacheStore,
			subscriptions as unknown as SubscriptionRepository,
			transactions as unknown as TransactionRunner,
		);
	});

	it('keys the entry by account, so one company never reads another', () => {
		expect(entitlementCacheKey(ACCOUNT)).toEqual(KEY);
		expect(entitlementCacheKey('acc-2').owner).toBe('acc-2');
	});

	describe('with a warm cache', () => {
		it('derives the entitlements from the map without reading the subscription', async () => {
			cache.get.mockResolvedValue({ tier: 'pro' });

			expect(await service.forAccount(ACCOUNT)).toEqual({
				tier: 'pro',
				entitlements: ENTITLEMENTS.pro,
			});
			expect(subscriptions.findByAccount).not.toHaveBeenCalled();
			expect(transactions.runInAccount).not.toHaveBeenCalled();
		});

		it('treats a cached absence of tier as a hit, not as a miss', async () => {
			cache.get.mockResolvedValue({ tier: null });

			expect(await service.forAccount(ACCOUNT)).toEqual({
				tier: null,
				entitlements: UNSUBSCRIBED_ENTITLEMENTS,
			});
			expect(subscriptions.findByAccount).not.toHaveBeenCalled();
		});
	});

	describe('with a cold cache', () => {
		it('resolves a paid subscription to the tier and stores the tier, not the entitlements', async () => {
			subscriptions.findByAccount.mockResolvedValue({ status: 'active' });

			expect(await service.forAccount(ACCOUNT)).toEqual({
				tier: 'pro',
				entitlements: ENTITLEMENTS.pro,
			});
			expect(cache.set).toHaveBeenCalledWith(KEY, { tier: 'pro' }, 60);
		});

		it('resolves an account with no row to no tier', async () => {
			expect(await service.forAccount(ACCOUNT)).toEqual({
				tier: null,
				entitlements: UNSUBSCRIBED_ENTITLEMENTS,
			});
			expect(cache.set).toHaveBeenCalledWith(KEY, { tier: null }, 60);
		});

		it('takes the tier away while the account is in dunning', async () => {
			subscriptions.findByAccount.mockResolvedValue({ status: 'past_due' });

			expect((await service.forAccount(ACCOUNT)).tier).toBeNull();
		});

		it('opens its own transaction when it runs ahead of the request one', async () => {
			await service.forAccount(ACCOUNT);

			expect(transactions.runInAccount).toHaveBeenCalledTimes(1);
			expect(transactions.runInAccount.mock.calls[0]?.[0]).toBe(ACCOUNT);
			expect(subscriptions.findByAccount).toHaveBeenCalledWith(ACCOUNT, EXECUTOR);
		});

		it('joins the request transaction instead of opening a second one', async () => {
			await runInScope(EXECUTOR, () => service.forAccount(ACCOUNT));

			expect(transactions.runInAccount).not.toHaveBeenCalled();
			expect(subscriptions.findByAccount).toHaveBeenCalledWith(ACCOUNT, EXECUTOR);
		});
	});

	describe('invalidate', () => {
		it('drops exactly the entry the reader would have found', async () => {
			await service.invalidate(ACCOUNT);

			expect(cache.delete).toHaveBeenCalledWith(KEY);
		});
	});
});
