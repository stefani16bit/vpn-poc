import '../../e2e.setup.js';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '@vpn-poc/database';

const DATABASE_URL =
	process.env['DATABASE_URL'] ?? 'postgres://vpn_app:vpn_app_dev@127.0.0.1:25432/poc_vpn_dev';

const { sql } = createDatabase({ url: DATABASE_URL, maxConnections: 2 });

const ACCOUNT = '33333333-3333-3333-3333-333333333333';
const USER = 'a3333333-3333-3333-3333-333333333333';
const REGION = 'b3333333-3333-3333-3333-333333333333';
const SAO_PAULO = 'c3333333-3333-3333-3333-333333333333';
const FRANKFURT = 'c4444444-4444-4444-4444-444444444444';
const ADDRESS = '10.13.13.4/32';

type Sql = typeof sql;

function asSystem<T>(work: (tx: Sql) => Promise<T>): Promise<T> {
	return sql.begin(async (tx) => {
		await tx`set local role app_system`;
		return work(tx as unknown as Sql);
	}) as Promise<T>;
}

function claim(tx: Sql, nodeId: string, publicKey: string, slot: number): Promise<unknown> {
	return tx`
		insert into devices (account_id, user_id, name, public_key, tunnel_address, account_slot, region_id, exit_node_id)
		values (${ACCOUNT}, ${USER}, 'laptop', ${publicKey}, ${ADDRESS}, ${slot}, ${REGION}, ${nodeId})
	`;
}

beforeEach(async () => {
	await asSystem(async (tx) => {
		await tx`update devices set revoked_at = now() where account_id = ${ACCOUNT}`;
		await tx`delete from accounts where id = ${ACCOUNT}`;
		await tx`insert into accounts (id, slug, name) values (${ACCOUNT}, 'alloc', 'alloc')`;
		await tx`
			insert into users (id, account_id, email, password_hash, role)
			values (${USER}, ${ACCOUNT}, 'owner@alloc.example.com', 'x', 'owner')
		`;
		await tx`
			insert into regions (id, account_id, name, slug)
			values (${REGION}, ${ACCOUNT}, 'Europa', 'europa')
		`;
		for (const node of [
			{ id: SAO_PAULO, label: 'sp1' },
			{ id: FRANKFURT, label: 'fra1' },
		]) {
			await tx`
				insert into exit_nodes (id, account_id, region_id, label, endpoint, control_url, public_key, tunnel_cidr, credential_ref)
				values (${node.id}, ${ACCOUNT}, ${REGION}, ${node.label}, '203.0.113.30:51820',
					'http://203.0.113.30:51821', ${`alloc-node-${node.label}`}, '10.13.13.0/24', ${`poc-vpn/exit-node/${node.label}`})
			`;
		}
	});
});

afterAll(async () => {
	await asSystem(async (tx) => {
		await tx`update devices set revoked_at = now() where account_id = ${ACCOUNT}`;
		await tx`delete from accounts where id = ${ACCOUNT}`;
	});
	await sql.end({ timeout: 5 });
});

describe('the tunnel address', () => {
	it('is the same address on two nodes, which is what raised the ceiling', async () => {
		await asSystem(async (tx) => {
			await claim(tx, SAO_PAULO, 'alloc-pk-sp', 0);
			await claim(tx, FRANKFURT, 'alloc-pk-fra', 1);
		});

		const rows = await asSystem(
			(tx) => tx`
				select exit_node_id from devices
				where account_id = ${ACCOUNT} and tunnel_address = ${ADDRESS} and revoked_at is null
			`,
		);

		expect(rows.map((row) => row['exit_node_id']).sort()).toEqual([SAO_PAULO, FRANKFURT].sort());
	});

	it('is still claimed once per node, and the index is what refuses the second', async () => {
		await asSystem((tx) => claim(tx, SAO_PAULO, 'alloc-pk-sp', 0));

		await expect(asSystem((tx) => claim(tx, SAO_PAULO, 'alloc-pk-other', 1))).rejects.toMatchObject(
			{ code: '23505' },
		);
	});

	it('goes back to the node as soon as the device is revoked', async () => {
		await asSystem(async (tx) => {
			await claim(tx, SAO_PAULO, 'alloc-pk-sp', 0);
			await tx`update devices set revoked_at = now() where public_key = 'alloc-pk-sp'`;
		});

		await asSystem((tx) => claim(tx, SAO_PAULO, 'alloc-pk-next', 1));

		const rows = await asSystem(
			(tx) => tx`
				select public_key from devices
				where exit_node_id = ${SAO_PAULO} and revoked_at is null
			`,
		);

		expect(rows.map((row) => row['public_key'])).toEqual(['alloc-pk-next']);
	});
});
