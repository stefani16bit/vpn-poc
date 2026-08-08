import '../../e2e.setup.js';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '@vpn-poc/database';
import { ENTITLEMENTS, UNSUBSCRIBED_ENTITLEMENTS } from '@vpn/contracts';
import { FixedClock, MemoryCacheStore } from '@vpn/testing/fakes';

import { TransactionRunner } from '../database/transaction-runner.js';
import { SubscriptionRepository } from '../subscriptions/subscription.repository.js';
import { EntitlementsService } from './entitlements.service.js';

const DATABASE_URL =
	process.env['DATABASE_URL'] ?? 'postgres://vpn_app:vpn_app_dev@127.0.0.1:25432/poc_vpn_dev';

const { db, sql } = createDatabase({ url: DATABASE_URL, maxConnections: 4 });

const PAID = '66666666-6666-6666-6666-666666666666';
const UNPAID = '77777777-7777-7777-7777-777777777777';

const transactions = new TransactionRunner(db);
const subscriptions = new SubscriptionRepository(db);

let service: EntitlementsService;

type SystemSql = typeof sql;

function asSystem<T>(work: (tx: SystemSql) => Promise<T>): Promise<T> {
	return sql.begin(async (tx) => {
		await tx`set local role app_system`;
		return work(tx as unknown as SystemSql);
	}) as Promise<T>;
}

async function wipe(): Promise<void> {
	await asSystem((tx) => tx`delete from accounts where id in (${PAID}, ${UNPAID})`);
}

beforeEach(async () => {
	await wipe();

	await asSystem(async (tx) => {
		for (const { id, slug } of [
			{ id: PAID, slug: 'entitlements-paid' },
			{ id: UNPAID, slug: 'entitlements-unpaid' },
		]) {
			await tx`insert into accounts (id, slug, name) values (${id}, ${slug}, ${slug})`;
		}

		await tx`
			insert into subscriptions (account_id, external_id, external_customer_id, status)
			values (${PAID}, ${`sub-${PAID}`}, ${`cus-${PAID}`}, 'active')
		`;
	});

	service = new EntitlementsService(
		new MemoryCacheStore(new FixedClock(new Date('2026-08-07T12:00:00.000Z'))),
		subscriptions,
		transactions,
	);
});

afterAll(async () => {
	await wipe();
	await sql.end({ timeout: 5 });
});

describe('reading entitlements ahead of the request transaction', () => {
	it('opens its own scope, where a bare query would raise 42704 instead', async () => {
		await expect(sql`select status from subscriptions`).rejects.toMatchObject({ code: '42704' });

		expect(await service.forAccount(PAID)).toEqual({
			tier: 'pro',
			entitlements: ENTITLEMENTS.pro,
		});
	});

	it('sees no row for an account without a subscription, rather than failing', async () => {
		expect(await service.forAccount(UNPAID)).toEqual({
			tier: null,
			entitlements: UNSUBSCRIBED_ENTITLEMENTS,
		});
	});

	it('reads the account it was asked about, not the one that happens to have a row', async () => {
		expect((await service.forAccount(PAID)).tier).toBe('pro');
		expect((await service.forAccount(UNPAID)).tier).toBeNull();
	});
});

describe('reading entitlements inside the request transaction', () => {
	it('joins the open scope instead of opening a second one', async () => {
		const inside = await transactions.runInAccount(PAID, () => service.forAccount(PAID));

		expect(inside.tier).toBe('pro');
	});
});

describe('invalidating', () => {
	it('makes the next read go back to the row', async () => {
		expect((await service.forAccount(PAID)).tier).toBe('pro');

		await asSystem(
			(tx) => tx`update subscriptions set status = 'canceled' where account_id = ${PAID}`,
		);
		expect((await service.forAccount(PAID)).tier).toBe('pro');

		await service.invalidate(PAID);

		expect((await service.forAccount(PAID)).tier).toBeNull();
	});
});
