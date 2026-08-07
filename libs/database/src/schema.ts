import { sql } from 'drizzle-orm';
import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from 'drizzle-orm/pg-core';

export const accounts = pgTable(
	'accounts',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		email: text('email').notNull(),
		passwordHash: text('password_hash').notNull(),
		emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
		locale: text('locale').notNull().default('pt-BR'),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
		updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [uniqueIndex('accounts_email_key').on(table.email)],
);

export const sessionFamilies = pgTable(
	'session_families',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		accountId: uuid('account_id')
			.notNull()
			.references(() => accounts.id, { onDelete: 'cascade' }),
		revokedAt: timestamp('revoked_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index('session_families_account_idx').on(table.accountId)],
);

export const refreshTokens = pgTable(
	'refresh_tokens',
	{
		tokenHash: text('token_hash').primaryKey(),
		familyId: uuid('family_id')
			.notNull()
			.references(() => sessionFamilies.id, { onDelete: 'cascade' }),
		spentAt: timestamp('spent_at', { withTimezone: true }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index('refresh_tokens_family_idx').on(table.familyId)],
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
		purpose: verificationPurpose('purpose').notNull(),
		consumedAt: timestamp('consumed_at', { withTimezone: true }),
		expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
		createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [index('verification_tokens_account_purpose_idx').on(table.accountId, table.purpose)],
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
	(table) => [uniqueIndex('subscriptions_external_id_key').on(table.externalId)],
);

export const billingEvents = pgTable(
	'billing_events',
	{
		id: uuid('id').primaryKey().defaultRandom(),
		source: text('source').notNull(),
		externalEventId: text('external_event_id').notNull(),
		kind: text('kind').notNull(),
		receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
	},
	(table) => [
		uniqueIndex('billing_events_source_external_id_key').on(table.source, table.externalEventId),
	],
);

export const outbox = pgTable(
	'outbox',
	{
		id: uuid('id').primaryKey().defaultRandom(),
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
	],
);
