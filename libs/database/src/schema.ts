import { sql } from 'drizzle-orm';
import {
	boolean,
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
		index('devices_user_idx').on(table.userId),
		uniqueIndex('devices_live_public_key_key')
			.on(table.publicKey)
			.where(sql`${table.revokedAt} is null`),
		uniqueIndex('devices_live_address_key')
			.on(table.tunnelAddress)
			.where(sql`${table.revokedAt} is null`),
		...scopedPolicies('devices'),
	],
);
