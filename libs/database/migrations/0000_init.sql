CREATE TYPE "public"."subscription_status" AS ENUM('active', 'trialing', 'past_due', 'canceled', 'incomplete');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('owner', 'admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."verification_purpose" AS ENUM('email_verification', 'password_reset');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"source" text NOT NULL,
	"external_event_id" text NOT NULL,
	"kind" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "outbox" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"family_id" uuid NOT NULL,
	"spent_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refresh_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "session_families" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_families_id_account_key" UNIQUE("id","account_id")
);
--> statement-breakpoint
ALTER TABLE "session_families" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"external_id" text NOT NULL,
	"external_customer_id" text NOT NULL,
	"status" "subscription_status" NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"last_event_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"locale" text DEFAULT 'pt-BR' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_id_account_key" UNIQUE("id","account_id")
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "verification_purpose" NOT NULL,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verification_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_events" ADD CONSTRAINT "billing_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_family_account_fk" FOREIGN KEY ("family_id","account_id") REFERENCES "public"."session_families"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_families" ADD CONSTRAINT "session_families_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_families" ADD CONSTRAINT "session_families_user_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."users"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."users"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_slug_key" ON "accounts" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_source_external_id_key" ON "billing_events" USING btree ("source","external_event_id");--> statement-breakpoint
CREATE INDEX "outbox_pending_key" ON "outbox" USING btree ("created_at") WHERE "outbox"."published_at" is null;--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "session_families_user_idx" ON "session_families" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_external_id_key" ON "subscriptions" USING btree ("external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_account_email_key" ON "users" USING btree ("account_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_account_owner_key" ON "users" USING btree ("account_id") WHERE "users"."role" = 'owner';--> statement-breakpoint
CREATE UNIQUE INDEX "users_owner_email_key" ON "users" USING btree ("email") WHERE "users"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "verification_tokens_user_purpose_idx" ON "verification_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE POLICY "accounts_tenant" ON "accounts" AS PERMISSIVE FOR ALL TO "vpn_app" USING (id = current_setting('app.account_id')::uuid) WITH CHECK (id = current_setting('app.account_id')::uuid);--> statement-breakpoint
CREATE POLICY "accounts_system" ON "accounts" AS PERMISSIVE FOR ALL TO "app_system" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "billing_events_tenant" ON "billing_events" AS PERMISSIVE FOR SELECT TO "vpn_app" USING (account_id = current_setting('app.account_id')::uuid);--> statement-breakpoint
CREATE POLICY "billing_events_system" ON "billing_events" AS PERMISSIVE FOR ALL TO "app_system" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "outbox_tenant" ON "outbox" AS PERMISSIVE FOR ALL TO "vpn_app" USING (account_id = current_setting('app.account_id')::uuid) WITH CHECK (account_id = current_setting('app.account_id')::uuid);--> statement-breakpoint
CREATE POLICY "outbox_system" ON "outbox" AS PERMISSIVE FOR ALL TO "app_system" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "refresh_tokens_tenant" ON "refresh_tokens" AS PERMISSIVE FOR ALL TO "vpn_app" USING (account_id = current_setting('app.account_id')::uuid) WITH CHECK (account_id = current_setting('app.account_id')::uuid);--> statement-breakpoint
CREATE POLICY "refresh_tokens_system" ON "refresh_tokens" AS PERMISSIVE FOR ALL TO "app_system" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "session_families_tenant" ON "session_families" AS PERMISSIVE FOR ALL TO "vpn_app" USING (account_id = current_setting('app.account_id')::uuid) WITH CHECK (account_id = current_setting('app.account_id')::uuid);--> statement-breakpoint
CREATE POLICY "session_families_system" ON "session_families" AS PERMISSIVE FOR ALL TO "app_system" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "subscriptions_tenant" ON "subscriptions" AS PERMISSIVE FOR ALL TO "vpn_app" USING (account_id = current_setting('app.account_id')::uuid) WITH CHECK (account_id = current_setting('app.account_id')::uuid);--> statement-breakpoint
CREATE POLICY "subscriptions_system" ON "subscriptions" AS PERMISSIVE FOR ALL TO "app_system" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "users_tenant" ON "users" AS PERMISSIVE FOR ALL TO "vpn_app" USING (account_id = current_setting('app.account_id')::uuid) WITH CHECK (account_id = current_setting('app.account_id')::uuid);--> statement-breakpoint
CREATE POLICY "users_system" ON "users" AS PERMISSIVE FOR ALL TO "app_system" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "verification_tokens_tenant" ON "verification_tokens" AS PERMISSIVE FOR ALL TO "vpn_app" USING (account_id = current_setting('app.account_id')::uuid) WITH CHECK (account_id = current_setting('app.account_id')::uuid);--> statement-breakpoint
CREATE POLICY "verification_tokens_system" ON "verification_tokens" AS PERMISSIVE FOR ALL TO "app_system" USING (true) WITH CHECK (true);