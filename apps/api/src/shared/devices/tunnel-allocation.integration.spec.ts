import '../../e2e.setup.js';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '@vpn-poc/database';

const DATABASE_URL =
	process.env['DATABASE_URL'] ?? 'postgres://vpn_app:vpn_app_dev@127.0.0.1:25432/poc_vpn_dev';

const { sql } = createDatabase({ url: DATABASE_URL, maxConnections: 2 });

const A = '33333333-3333-3333-3333-333333333333';
const B = '44444444-4444-4444-4444-444444444444';
const ADDRESS_OF_A = '10.13.13.211/32';
const ADDRESS_OF_B = '10.13.13.212/32';

type Sql = typeof sql;

function asSystem<T>(work: (tx: Sql) => Promise<T>): Promise<T> {
	return sql.begin(async (tx) => {
		await tx`set local role app_system`;
		return work(tx as unknown as Sql);
	}) as Promise<T>;
}

function asAccount<T>(accountId: string, work: (tx: Sql) => Promise<T>): Promise<T> {
	return sql.begin(async (tx) => {
		await tx`select set_config('app.account_id', ${accountId}, true)`;
		return work(tx as unknown as Sql);
	}) as Promise<T>;
}

function userIdFor(accountId: string): string {
	return accountId.replace(/^./, 'a');
}

beforeAll(async () => {
	await asSystem(async (tx) => {
		await tx`delete from accounts where id in (${A}, ${B})`;

		for (const { id, address } of [
			{ id: A, address: ADDRESS_OF_A },
			{ id: B, address: ADDRESS_OF_B },
		]) {
			const slug = `alloc-${id.slice(0, 4)}`;
			await tx`insert into accounts (id, slug, name) values (${id}, ${slug}, ${slug})`;
			await tx`
				insert into users (id, account_id, email, password_hash, role)
				values (${userIdFor(id)}, ${id}, ${`owner@${slug}.example.com`}, 'x', 'owner')
			`;
			await tx`
				insert into devices (account_id, user_id, name, public_key, tunnel_address, account_slot)
				values (${id}, ${userIdFor(id)}, 'laptop', ${`pk-${slug}`}, ${address}, 0)
			`;
		}
	});
});

afterAll(async () => {
	await asSystem(async (tx) => {
		await tx`update devices set revoked_at = now() where account_id in (${A}, ${B})`;
		await tx`delete from accounts where id in (${A}, ${B})`;
	});
	await sql.end({ timeout: 5 });
});

describe('live_tunnel_addresses', () => {
	it('reports an address the tenant policy hides, which is the whole point', async () => {
		const throughTheTable = await asAccount(
			B,
			(tx) => tx`select tunnel_address from devices order by tunnel_address`,
		);
		const throughTheView = await asAccount(
			B,
			(tx) => tx`select tunnel_address from live_tunnel_addresses order by tunnel_address`,
		);

		const table = throughTheTable.map((row) => row['tunnel_address']);
		const view = throughTheView.map((row) => row['tunnel_address']);

		expect(table).toContain(ADDRESS_OF_B);
		expect(table).not.toContain(ADDRESS_OF_A);

		expect(view).toContain(ADDRESS_OF_B);
		expect(view).toContain(ADDRESS_OF_A);
	});

	it('reports only the address, so no tenant is identifiable through it', async () => {
		const [row] = await asAccount(B, (tx) => tx`select * from live_tunnel_addresses limit 1`);

		expect(Object.keys(row ?? {})).toEqual(['tunnel_address']);
	});

	it('forgets an address as soon as the device is revoked', async () => {
		await asSystem(
			(tx) => tx`update devices set revoked_at = now() where tunnel_address = ${ADDRESS_OF_A}`,
		);

		const view = await asAccount(B, (tx) => tx`select tunnel_address from live_tunnel_addresses`);
		expect(view.map((row) => row['tunnel_address'])).not.toContain(ADDRESS_OF_A);

		await asSystem(
			(tx) => tx`update devices set revoked_at = null where tunnel_address = ${ADDRESS_OF_A}`,
		);
	});
});
