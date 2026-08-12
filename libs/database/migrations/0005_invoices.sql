CREATE TYPE "public"."invoice_status" AS ENUM('paid', 'failed');--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"number" text,
	"status" "invoice_status" NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"pdf_key" text,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_account_external_id_key" ON "invoices" USING btree ("account_id","external_id");--> statement-breakpoint
CREATE INDEX "invoices_account_issued_at_idx" ON "invoices" USING btree ("account_id","issued_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "invoices_tenant" ON "invoices" AS PERMISSIVE FOR ALL TO "vpn_app" USING (account_id = current_setting('app.account_id')::uuid) WITH CHECK (account_id = current_setting('app.account_id')::uuid);--> statement-breakpoint
CREATE POLICY "invoices_system" ON "invoices" AS PERMISSIVE FOR ALL TO "app_system" USING (true) WITH CHECK (true);