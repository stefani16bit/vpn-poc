CREATE TABLE "role_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"permission" text NOT NULL,
	"granted" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_account_role_permission_key" UNIQUE("account_id","role","permission")
);
--> statement-breakpoint
ALTER TABLE "role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"permission" text NOT NULL,
	"granted" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_permissions_account_user_permission_key" UNIQUE("account_id","user_id","permission")
);
--> statement-breakpoint
ALTER TABLE "user_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_permissions" ADD CONSTRAINT "user_permissions_user_account_fk" FOREIGN KEY ("user_id","account_id") REFERENCES "public"."users"("id","account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "role_permissions_tenant" ON "role_permissions" AS PERMISSIVE FOR ALL TO "vpn_app" USING (account_id = current_setting('app.account_id')::uuid) WITH CHECK (account_id = current_setting('app.account_id')::uuid);--> statement-breakpoint
CREATE POLICY "role_permissions_system" ON "role_permissions" AS PERMISSIVE FOR ALL TO "app_system" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "user_permissions_tenant" ON "user_permissions" AS PERMISSIVE FOR ALL TO "vpn_app" USING (account_id = current_setting('app.account_id')::uuid) WITH CHECK (account_id = current_setting('app.account_id')::uuid);--> statement-breakpoint
CREATE POLICY "user_permissions_system" ON "user_permissions" AS PERMISSIVE FOR ALL TO "app_system" USING (true) WITH CHECK (true);