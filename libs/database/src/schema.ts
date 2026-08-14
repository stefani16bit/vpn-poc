import { sql } from 'drizzle-orm';
import {
	boolean,
	check,
	foreignKey,
	pgPolicy,
	pgRole,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';

export const vpnApp = pgRole('vpn_app').existing();
export const appSystem = pgRole('app_system').existing();

const tenantOf = (column: string) => sql.raw(`${column} = current_setting('app.account_id')::uuid`);

function scopedPolicies(table: string, column = 'account_id') {
	return [
		pgPolicy(`${table}_tenant`, {
			as: 'permissive',
			for: 'all',
			to: vpnApp,
			using: tenantOf(column),
			withCheck: tenantOf(column),
		}),
		pgPolicy(`${table}_system`, {
			as: 'permissive',
			for: 'all',
			to: appSystem,
			using: sql`true`,
			withCheck: sql`true`,
		}),
	];
}

export const accounts = pgTable(
	'accounts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		slug: text('slug').notNull(),
		name: text('name').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [uniqueIndex('accounts_slug_key').on(table.slug), ...scopedPolicies('accounts', 'id')],
);

export const userRole = pgEnum('user_role', ['owner', 'admin', 'member']);

export const users = pgTable(
	'users',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		email: text('email').notNull(),
		passwordHash: text('password_hash').notNull(),
		role: userRole('role').notNull(),
		emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
		locale: text('locale').notNull().default('pt-BR'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex('users_account_email_key').on(table.accountId, table.email),
		unique('users_id_account_key').on(table.id, table.accountId),
		uniqueIndex('users_account_owner_key')
			.on(table.accountId)
			.where(sql`${table.role} = 'owner'`),
		uniqueIndex('users_owner_email_key')
			.on(table.email)
			.where(sql`${table.role} = 'owner'`),
		...scopedPolicies('users'),
	],
);

export const sessionFamilies = pgTable(
	'session_families',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		userId: uuid('user_id').notNull(),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index('session_families_user_idx').on(table.userId),
		unique('session_families_id_account_key').on(table.id, table.accountId),
		foreignKey({
			columns: [table.userId, table.accountId],
			foreignColumns: [users.id, users.accountId],
			name: 'session_families_user_account_fk',
		}).onDelete('cascade'),
		...scopedPolicies('session_families'),
	],
);

export const refreshTokens = pgTable(
	'refresh_tokens',
	{
		tokenHash: text('token_hash').primaryKey(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		familyId: uuid('family_id').notNull(),
		spentAt: timestamp('spent_at', { withTimezone: true }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index('refresh_tokens_family_idx').on(table.familyId),
		foreignKey({
			columns: [table.familyId, table.accountId],
			foreignColumns: [sessionFamilies.id, sessionFamilies.accountId],
			name: 'refresh_tokens_family_account_fk',
		}).onDelete('cascade'),
		...scopedPolicies('refresh_tokens'),
	],
);

export const verificationPurpose = pgEnum('verification_purpose', [
	'email_verification',
	'password_reset',
]);

export const verificationTokens = pgTable(
	'verification_tokens',
	{
		tokenHash: text('token_hash').primaryKey(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		userId: uuid('user_id').notNull(),
		purpose: verificationPurpose('purpose').notNull(),
		consumedAt: timestamp('consumed_at', { withTimezone: true }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		index('verification_tokens_user_purpose_idx').on(table.userId, table.purpose),
		foreignKey({
			columns: [table.userId, table.accountId],
			foreignColumns: [users.id, users.accountId],
			name: 'verification_tokens_user_account_fk',
		}).onDelete('cascade'),
		...scopedPolicies('verification_tokens'),
	],
);

export const subscriptionStatus = pgEnum('subscription_status', [
	'active',
	'trialing',
	'past_due',
	'canceled',
	'incomplete',
]);

export const subscriptions = pgTable(
	'subscriptions',
	{
		accountId: uuid('account_id')
			.primaryKey()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		externalId: text('external_id').notNull(),
		externalCustomerId: text('external_customer_id').notNull(),
		status: subscriptionStatus('status').notNull(),
		currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
		cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
		lastEventAt: timestamp('last_event_at', { withTimezone: true }),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex('subscriptions_external_id_key').on(table.externalId),
		...scopedPolicies('subscriptions'),
	],
);

export const invoiceStatus = pgEnum('invoice_status', ['paid', 'failed']);

export const invoices = pgTable(
	'invoices',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		externalId: text('external_id').notNull(),
		number: text('number'),
		status: invoiceStatus('status').notNull(),
		amountCents: integer('amount_cents').notNull(),
		currency: text('currency').notNull(),
		issuedAt: timestamp('issued_at', { withTimezone: true }).notNull(),
		pdfKey: text('pdf_key'),
		lastEventAt: timestamp('last_event_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex('invoices_account_external_id_key').on(table.accountId, table.externalId),
		index('invoices_account_issued_at_idx').on(table.accountId, table.issuedAt.desc()),
		...scopedPolicies('invoices'),
	],
);

export const billingEvents = pgTable(
	'billing_events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'set null' }),
		source: text('source').notNull(),
		externalEventId: text('external_event_id').notNull(),
		kind: text('kind').notNull(),
		receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex('billing_events_source_external_id_key').on(table.source, table.externalEventId),
		pgPolicy('billing_events_tenant', {
			as: 'permissive',
			for: 'select',
			to: vpnApp,
			using: tenantOf('account_id'),
		}),
		pgPolicy('billing_events_system', {
			as: 'permissive',
			for: 'all',
			to: appSystem,
			using: sql`true`,
			withCheck: sql`true`,
		}),
	],
);

export const outbox = pgTable(
	'outbox',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		kind: text('kind').notNull(),
		payload: jsonb('payload').notNull(),
		attempts: integer('attempts').notNull().default(0),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		publishedAt: timestamp('published_at', { withTimezone: true }),
	},
	(table) => [
		index('outbox_pending_key')
			.on(table.createdAt)
			.where(sql`${table.publishedAt} is null`),
		...scopedPolicies('outbox'),
	],
);

// The fleet is the platform's, so these two carry no account_id and no policy —
// the only domain tables that do not. Not being under a policy is not the same
// as being writable: the migration REVOKEs INSERT, UPDATE and DELETE from
// vpn_app, which is what the default privileges would otherwise have granted.
export const regions = pgTable(
	'regions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		name: text('name').notNull(),
		slug: text('slug').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [uniqueIndex('regions_slug_key').on(table.slug)],
);

export const exitNodes = pgTable(
	'exit_nodes',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		regionId: uuid('region_id').notNull(),
		label: text('label').notNull(),
		endpoint: text('endpoint').notNull(),
		controlUrl: text('control_url').notNull(),
		publicKey: text('public_key').notNull(),
		tunnelCidr: text('tunnel_cidr').notNull(),
		// Where the credential lives, never the credential: a token on the row
		// travels into every backup and every SELECT *. Not nullable, because a
		// node with nowhere to read a credential from has no credential.
		credentialRef: text('credential_ref').notNull(),
		lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		foreignKey({
			columns: [table.regionId],
			foreignColumns: [regions.id],
			name: 'exit_nodes_region_fk',
		}).onDelete('restrict'),
		// The key is the node's identity on both ends and travels inside every
		// .conf, so two rows carrying one key are two names for one machine and no
		// config could tell them apart.
		uniqueIndex('exit_nodes_public_key_key').on(table.publicKey),
		unique('exit_nodes_id_region_key').on(table.id, table.regionId),
		index('exit_nodes_region_idx').on(table.regionId),
	],
);

export const devices = pgTable(
	'devices',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		userId: uuid('user_id').notNull(),
		name: text('name').notNull(),
		publicKey: text('public_key').notNull(),
		tunnelAddress: text('tunnel_address').notNull(),
		// The choice and the assignment, never one column: a device outlives the
		// node it landed on, and only the pair says which node served which choice.
		regionId: uuid('region_id'),
		exitNodeId: uuid('exit_node_id'),
		// The account's seat for this device. The unique index below is what caps
		// a tenant: a count() read before the INSERT is the check two concurrent
		// requests walk through together. DEC-043.
		accountSlot: integer('account_slot').notNull(),
		provisionedAt: timestamp('provisioned_at', { withTimezone: true }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		foreignKey({
			columns: [table.userId, table.accountId],
			foreignColumns: [users.id, users.accountId],
			name: 'devices_user_account_fk',
		}).onDelete('cascade'),
		foreignKey({
			columns: [table.regionId],
			foreignColumns: [regions.id],
			name: 'devices_region_fk',
		}).onDelete('restrict'),
		// Two columns and not one: the region is the choice and the node is the
		// assignment, and nothing but this refuses a device whose choice disagrees
		// with the node it was placed on. The migration narrows the SET NULL to
		// exit_node_id by hand — drizzle has no way to say it, and nulling
		// region_id would erase the choice when a machine is retired.
		foreignKey({
			columns: [table.exitNodeId, table.regionId],
			foreignColumns: [exitNodes.id, exitNodes.regionId],
			name: 'devices_exit_node_region_fk',
		}).onDelete('set null'),
		index('devices_user_idx').on(table.userId),
		uniqueIndex('devices_live_public_key_key')
			.on(table.publicKey)
			.where(sql`${table.revokedAt} is null`),
		uniqueIndex('devices_live_address_key')
			.on(table.exitNodeId, table.tunnelAddress)
			.where(sql`${table.revokedAt} is null`),
		check(
			'devices_live_has_placement',
			sql`${table.revokedAt} is not null or (${table.regionId} is not null and ${table.exitNodeId} is not null)`,
		),
		uniqueIndex('devices_live_account_slot_key')
			.on(table.accountId, table.accountSlot)
			.where(sql`${table.revokedAt} is null`),
		...scopedPolicies('devices'),
	],
);

export const rolePermissions = pgTable(
	'role_permissions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		role: userRole('role').notNull(),
		permission: text('permission').notNull(),
		granted: boolean('granted').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		unique('role_permissions_account_role_permission_key').on(
			table.accountId,
			table.role,
			table.permission,
		),
		...scopedPolicies('role_permissions'),
	],
);

export const userPermissions = pgTable(
	'user_permissions',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		userId: uuid('user_id').notNull(),
		permission: text('permission').notNull(),
		granted: boolean('granted').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		foreignKey({
			columns: [table.userId, table.accountId],
			foreignColumns: [users.id, users.accountId],
			name: 'user_permissions_user_account_fk',
		}).onDelete('cascade'),
		unique('user_permissions_account_user_permission_key').on(
			table.accountId,
			table.userId,
			table.permission,
		),
		...scopedPolicies('user_permissions'),
	],
);
