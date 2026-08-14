import '../../e2e.setup.js';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '@vpn-poc/database';

const DATABASE_URL =
	process.env['DATABASE_URL'] ?? 'postgres://vpn_app:vpn_app_dev@127.0.0.1:25432/poc_vpn_dev';

const { sql } = createDatabase({ url: DATABASE_URL, maxConnections: 2 });

const ACCOUNT = '55555555-5555-5555-5555-555555555555';
const USER = 'a5555555-5555-5555-5555-555555555555';
const EUROPE = 'b5555555-5555-5555-5555-555555555555';
const ASIA = 'b6666666-6666-6666-6666-666666666666';
const NODE_IN_EUROPE = 'c5555555-5555-5555-5555-555555555555';

type Sql = typeof sql;

function asSystem<T>(work: (tx: Sql) => Promise<T>): Promise<T> {
	return sql.begin(async (tx) => {
		await tx`set local role app_system`;
		return work(tx as unknown as Sql);
	}) as Promise<T>;
}

function placeDevice(tx: Sql, regionId: string, nodeId: string | null): Promise<unknown> {
	return tx`
		insert into devices (account_id, user_id, name, public_key, tunnel_address, account_slot, region_id, exit_node_id)
		values (${ACCOUNT}, ${USER}, 'laptop', 'placement-pk', '10.13.13.9/32', 0, ${regionId}, ${nodeId})
	`;
}

beforeEach(async () => {
	await asSystem(async (tx) => {
		await tx`update devices set revoked_at = now() where account_id = ${ACCOUNT}`;
		await tx`delete from accounts where id = ${ACCOUNT}`;
		await tx`insert into accounts (id, slug, name) values (${ACCOUNT}, 'placement', 'placement')`;
		await tx`
			insert into users (id, account_id, email, password_hash, role)
			values (${USER}, ${ACCOUNT}, 'owner@placement.example.com', 'x', 'owner')
		`;
		// Spec-owned rows rather than the seeded fleet: this file deletes a node to
		// prove the SET NULL, and the seed has to survive the whole suite. They are
		// no longer swept away by the account cascade, so afterAll has to clear them
		// or they surface in /regions as a failure in a different file.
		await tx`delete from exit_nodes where id = ${NODE_IN_EUROPE}`;
		await tx`delete from regions where id in (${EUROPE}, ${ASIA})`;
		await tx`
			insert into regions (id, name, slug)
			values (${EUROPE}, 'Europa placement', 'europa-placement'), (${ASIA}, 'Ásia placement', 'asia-placement')
		`;
		await tx`
			insert into exit_nodes (id, region_id, label, endpoint, control_url, public_key, tunnel_cidr, credential_ref)
			values (${NODE_IN_EUROPE}, ${EUROPE}, 'eu1', '203.0.113.20:51820',
				'http://203.0.113.20:51821', 'placement-node-pk', '10.13.13.0/24', 'poc-vpn/exit-node/eu1')
		`;
	});
});

afterAll(async () => {
	await asSystem(async (tx) => {
		await tx`update devices set revoked_at = now() where account_id = ${ACCOUNT}`;
		await tx`delete from accounts where id = ${ACCOUNT}`;
		await tx`delete from exit_nodes where id = ${NODE_IN_EUROPE}`;
		await tx`delete from regions where id in (${EUROPE}, ${ASIA})`;
	});
	await sql.end({ timeout: 5 });
});

describe('removing a node', () => {
	it('refuses while a key on it is live, and says which way out', async () => {
		await asSystem((tx) => placeDevice(tx, EUROPE, NODE_IN_EUROPE));

		await expect(
			asSystem((tx) => tx`delete from exit_nodes where id = ${NODE_IN_EUROPE}`),
		).rejects.toMatchObject({ message: expect.stringContaining('revoke them before') });
	});

	it('lets the node go once those keys are revoked, which is what the refusal promised', async () => {
		await asSystem(async (tx) => {
			await placeDevice(tx, EUROPE, NODE_IN_EUROPE);
			await tx`update devices set revoked_at = now() where account_id = ${ACCOUNT}`;
		});

		await asSystem((tx) => tx`delete from exit_nodes where id = ${NODE_IN_EUROPE}`);

		const [row] = await asSystem(
			(tx) => tx`select region_id, exit_node_id from devices where account_id = ${ACCOUNT}`,
		);

		expect(row?.['exit_node_id']).toBeNull();
		expect(row?.['region_id']).toBe(EUROPE);
	});
});

describe('placing a device', () => {
	it('refuses a region that disagrees with the region of its node', async () => {
		await expect(asSystem((tx) => placeDevice(tx, ASIA, NODE_IN_EUROPE))).rejects.toMatchObject({
			code: '23503',
		});
	});

	it('accepts the pair the node itself reports', async () => {
		await asSystem((tx) => placeDevice(tx, EUROPE, NODE_IN_EUROPE));

		const [row] = await asSystem(
			(tx) => tx`select exit_node_id from devices where account_id = ${ACCOUNT}`,
		);

		expect(row?.['exit_node_id']).toBe(NODE_IN_EUROPE);
	});
});
