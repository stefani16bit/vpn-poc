import './e2e.setup.js';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, platformNode } from '@vpn-poc/database';

const DATABASE_URL =
	process.env['DATABASE_URL'] ?? 'postgres://vpn_app:vpn_app_dev@127.0.0.1:25432/poc_vpn_dev';

const { sql } = createDatabase({ url: DATABASE_URL, maxConnections: 2 });

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

const SEEDED = platformNode('sa');

type Row = Record<string, unknown>;

async function asSystem<T>(work: (tx: SystemSql) => Promise<T>): Promise<T> {
	return sql.begin(async (tx) => {
		await tx`set local role app_system`;
		return work(tx as unknown as SystemSql);
	}) as Promise<T>;
}

async function asAccount(accountId: string, statement: (tx: SystemSql) => Promise<Row[]>) {
	return sql.begin(async (tx) => {
		await tx`select set_config('app.account_id', ${accountId}, true)`;
		return statement(tx as unknown as SystemSql);
	});
}

type SystemSql = typeof sql;

beforeAll(async () => {
	await asSystem(async (tx) => {
		await tx`delete from billing_events`;
		await tx`delete from outbox`;
		await tx`update devices set revoked_at = now() where revoked_at is null`;
		await tx`delete from accounts where id in (${A}, ${B})`;

		for (const { id, slug } of [
			{ id: A, slug: 'rls-a' },
			{ id: B, slug: 'rls-b' },
		]) {
			await tx`insert into accounts (id, slug, name) values (${id}, ${slug}, ${slug})`;
			await tx`
				insert into users (id, account_id, email, password_hash, role)
				values (${userIdFor(id)}, ${id}, ${`owner@${slug}.example.com`}, 'x', 'owner')
			`;
			await tx`
				insert into session_families (id, account_id, user_id)
				values (${familyIdFor(id)}, ${id}, ${userIdFor(id)})
			`;
			await tx`
				insert into refresh_tokens (token_hash, account_id, family_id, expires_at)
				values (${`hash-${slug}`}, ${id}, ${familyIdFor(id)}, now() + interval '1 day')
			`;
			await tx`
				insert into verification_tokens (token_hash, account_id, user_id, purpose, expires_at)
				values (${`vt-${slug}`}, ${id}, ${userIdFor(id)}, 'email_verification', now() + interval '1 day')
			`;
			await tx`
				insert into subscriptions (account_id, external_id, external_customer_id, status)
				values (${id}, ${`sub-${slug}`}, ${`cus-${slug}`}, 'active')
			`;
			await tx`
				insert into billing_events (account_id, source, external_event_id, kind)
				values (${id}, 'stripe', ${`evt-${slug}`}, 'payment_failed')
			`;
			await tx`
				insert into outbox (account_id, kind, payload)
				values (${id}, 'auth.welcome', ${JSON.stringify({ kind: 'auth.welcome', userId: userIdFor(id) })}::jsonb)
			`;
			// Both accounts land on the same platform node on purpose: two tenants
			// sharing one machine, isolated by the policy on devices and by nothing
			// on the node itself, is exactly what the fleet being ours means.
			await tx`
				insert into devices (account_id, user_id, name, public_key, tunnel_address, account_slot, region_id, exit_node_id)
				values (${id}, ${userIdFor(id)}, 'laptop', ${`pk-${slug}`}, ${`10.13.13.${id === A ? 101 : 102}/32`}, 0,
					${SEEDED.regionId}, ${SEEDED.nodeId})
			`;
			await tx`
				insert into role_permissions (account_id, role, permission, granted)
				values (${id}, 'member', ${`devices.create-${slug}`}, false)
			`;
			await tx`
				insert into user_permissions (account_id, user_id, permission, granted)
				values (${id}, ${userIdFor(id)}, ${`devices.create-${slug}`}, true)
			`;
		}
	});
});

afterAll(async () => {
	await asSystem(async (tx) => {
		await tx`delete from billing_events`;
		await tx`delete from outbox`;
		await tx`update devices set revoked_at = now() where revoked_at is null`;
		await tx`delete from accounts where id in (${A}, ${B})`;
	});
	await sql.end({ timeout: 5 });
});

function userIdFor(accountId: string): string {
	return accountId.replace(/^./, 'a');
}

function familyIdFor(accountId: string): string {
	return accountId.replace(/^./, 'f');
}

describe('the suite connects as the role the policies are written against', () => {
	it('is vpn_app, not the table owner', async () => {
		const [row] = await sql`select current_user`;
		expect(row?.['current_user']).toBe('vpn_app');
	});

	it('raises rather than returning nothing when no scope is set', async () => {
		await expect(sql`select id from users`).rejects.toMatchObject({ code: '42704' });
	});
});

const TABLES = [
	{
		name: 'accounts',
		read: (tx: SystemSql, id: string) => tx`select id from accounts where id = ${id}`,
	},
	{
		name: 'users',
		read: (tx: SystemSql, id: string) =>
			tx`select id from users where email = ${`owner@rls-${id === A ? 'a' : 'b'}.example.com`}`,
	},
	{
		name: 'session_families',
		read: (tx: SystemSql, id: string) =>
			tx`select id from session_families where id = ${familyIdFor(id)}`,
	},
	{
		name: 'refresh_tokens',
		read: (tx: SystemSql, id: string) =>
			tx`select token_hash from refresh_tokens where token_hash = ${`hash-rls-${id === A ? 'a' : 'b'}`}`,
	},
	{
		name: 'verification_tokens',
		read: (tx: SystemSql, id: string) =>
			tx`select token_hash from verification_tokens where token_hash = ${`vt-rls-${id === A ? 'a' : 'b'}`}`,
	},
	{
		name: 'subscriptions',
		read: (tx: SystemSql, id: string) =>
			tx`select account_id from subscriptions where account_id = ${id}`,
	},
	{
		name: 'billing_events',
		read: (tx: SystemSql, id: string) =>
			tx`select id from billing_events where external_event_id = ${`evt-rls-${id === A ? 'a' : 'b'}`}`,
	},
	{
		name: 'outbox',
		read: (tx: SystemSql, id: string) => tx`select id from outbox where account_id = ${id}`,
	},
	{
		name: 'devices',
		read: (tx: SystemSql, id: string) =>
			tx`select id from devices where public_key = ${`pk-rls-${id === A ? 'a' : 'b'}`}`,
	},
	{
		name: 'role_permissions',
		read: (tx: SystemSql, id: string) =>
			tx`select id from role_permissions where permission = ${`devices.create-rls-${id === A ? 'a' : 'b'}`}`,
	},
	{
		name: 'user_permissions',
		read: (tx: SystemSql, id: string) =>
			tx`select id from user_permissions where permission = ${`devices.create-rls-${id === A ? 'a' : 'b'}`}`,
	},
] as const;

describe.each(TABLES)('$name is isolated by account', ({ read }) => {
	it('returns the row belonging to the scoped account', async () => {
		const rows = await asAccount(A, (tx) => read(tx, A) as Promise<Row[]>);
		expect(rows).toHaveLength(1);
	});

	it('returns nothing for a row belonging to another account', async () => {
		const rows = await asAccount(A, (tx) => read(tx, B) as Promise<Row[]>);
		expect(rows).toHaveLength(0);
	});

	it('lets the system role across both accounts, which the relay depends on', async () => {
		const rows = await asSystem(async (tx) => [
			...((await read(tx, A)) as Row[]),
			...((await read(tx, B)) as Row[]),
		]);
		expect(rows).toHaveLength(2);
	});
});

// The fleet is ours, so it is deliberately not isolated — every tenant sees the
// same five regions. What replaces the isolation is a narrower grant: read, and
// nothing else. These two tests are the whole difference between a platform
// table and a table somebody forgot to put a policy on.
describe('the platform fleet', () => {
	it('reads the same to whichever account is scoped', async () => {
		const forA = await asAccount(A, (tx) => tx`select id from exit_nodes` as Promise<Row[]>);
		const forB = await asAccount(B, (tx) => tx`select id from exit_nodes` as Promise<Row[]>);

		expect(forA).toHaveLength(5);
		expect(forA).toEqual(forB);
	});

	it.each(['regions', 'exit_nodes'])('refuses a tenant writing %s', async (table) => {
		await expect(
			asAccount(A, async (tx) => {
				await tx`update ${tx(table)} set created_at = now()`;
				return [];
			}),
		).rejects.toMatchObject({ code: '42501' });
	});
});

describe('write side', () => {
	it('refuses to plant a row in another account', async () => {
		await expect(
			asAccount(A, async (tx) => {
				await tx`
					insert into outbox (account_id, kind, payload)
					values (${B}, 'auth.welcome', ${JSON.stringify({ kind: 'auth.welcome', userId: userIdFor(B) })}::jsonb)
				`;
				return [];
			}),
		).rejects.toMatchObject({ code: '42501' });
	});

	it('keeps the ledger read-only for a tenant, since only the webhook writes it', async () => {
		await expect(
			asAccount(A, async (tx) => {
				await tx`
					insert into billing_events (account_id, source, external_event_id, kind)
					values (${A}, 'stripe', 'evt-tenant-write', 'payment_failed')
				`;
				return [];
			}),
		).rejects.toMatchObject({ code: '42501' });
	});
});

describe('the policy set itself', () => {
	it('is exactly the twenty-four policies the schema declares, and none for the fleet', async () => {
		const rows = await sql`
			select tablename, policyname from pg_policies
			where schemaname = 'public' order by tablename, policyname
		`;

		expect(rows.map((row) => `${row['tablename']}.${row['policyname']}`)).toEqual([
			'accounts.accounts_system',
			'accounts.accounts_tenant',
			'billing_events.billing_events_system',
			'billing_events.billing_events_tenant',
			'devices.devices_system',
			'devices.devices_tenant',
			'invoices.invoices_system',
			'invoices.invoices_tenant',
			'outbox.outbox_system',
			'outbox.outbox_tenant',
			'refresh_tokens.refresh_tokens_system',
			'refresh_tokens.refresh_tokens_tenant',
			'role_permissions.role_permissions_system',
			'role_permissions.role_permissions_tenant',
			'session_families.session_families_system',
			'session_families.session_families_tenant',
			'subscriptions.subscriptions_system',
			'subscriptions.subscriptions_tenant',
			'user_permissions.user_permissions_system',
			'user_permissions.user_permissions_tenant',
			'users.users_system',
			'users.users_tenant',
			'verification_tokens.verification_tokens_system',
			'verification_tokens.verification_tokens_tenant',
		]);
	});

	// Set equality and not an exclusion list: this fails if a third table shows up
	// without RLS, and it fails just as loudly if somebody switches RLS on for one
	// of these two, which would silently hide the whole fleet from every tenant.
	it('leaves exactly the two platform tables outside row level security', async () => {
		const rows = await sql`
			select c.relname from pg_class c
			join pg_namespace n on n.oid = c.relnamespace
			where n.nspname = 'public' and c.relkind = 'r'
				and c.relname <> '__drizzle_migrations' and not c.relrowsecurity
			order by c.relname
		`;

		expect(rows.map((row) => row['relname'])).toEqual(['exit_nodes', 'regions']);
	});
});

describe('a live device cannot vanish', () => {
	it('refuses to delete a row the node is still serving', async () => {
		await expect(
			asSystem((tx) => tx`delete from devices where account_id = ${A}`),
		).rejects.toMatchObject({ code: '23001' });
	});

	it('refuses just as hard when the delete arrives as a cascade from accounts', async () => {
		await expect(asSystem((tx) => tx`delete from accounts where id = ${A}`)).rejects.toMatchObject({
			code: '23001',
		});
	});

	it('lets a revoked device go, which is the order the outbox can carry', async () => {
		await asSystem(async (tx) => {
			await tx`update devices set revoked_at = now() where account_id = ${B}`;
			await tx`delete from devices where account_id = ${B}`;
		});

		const rows = await asSystem((tx) => tx`select id from devices where account_id = ${B}`);
		expect(rows).toEqual([]);
	});
});
