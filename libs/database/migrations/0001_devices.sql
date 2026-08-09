CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"public_key" text NOT NULL,
	"tunnel_address" text NOT NULL,
	"provisioned_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."users"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "devices_live_public_key_key" ON "devices" USING btree ("public_key") WHERE "devices"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_live_address_key" ON "devices" USING btree ("tunnel_address") WHERE "devices"."revoked_at" is null;--> statement-breakpoint
CREATE POLICY "devices_tenant" ON "devices" AS PERMISSIVE FOR ALL TO "vpn_app" USING (account_id = current_setting('app.account_id')::uuid) WITH CHECK (account_id = current_setting('app.account_id')::uuid);--> statement-breakpoint
CREATE POLICY "devices_system" ON "devices" AS PERMISSIVE FOR ALL TO "app_system" USING (true) WITH CHECK (true);