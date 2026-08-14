CREATE TABLE "exit_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region_id" uuid NOT NULL,
	"label" text NOT NULL,
	"endpoint" text NOT NULL,
	"control_url" text NOT NULL,
	"public_key" text NOT NULL,
	"tunnel_cidr" text NOT NULL,
	"credential_ref" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exit_nodes_id_region_key" UNIQUE("id","region_id")
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP VIEW "public"."live_tunnel_addresses";--> statement-breakpoint
DROP INDEX "devices_live_address_key";--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "region_id" uuid;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "exit_node_id" uuid;--> statement-breakpoint
ALTER TABLE "exit_nodes" ADD CONSTRAINT "exit_nodes_region_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exit_nodes_public_key_key" ON "exit_nodes" USING btree ("public_key");--> statement-breakpoint
CREATE INDEX "exit_nodes_region_idx" ON "exit_nodes" USING btree ("region_id");--> statement-breakpoint
CREATE UNIQUE INDEX "regions_slug_key" ON "regions" USING btree ("slug");--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_region_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_exit_node_region_fk" FOREIGN KEY ("exit_node_id","region_id") REFERENCES "public"."exit_nodes"("id","region_id") ON DELETE SET NULL ("exit_node_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_live_address_key" ON "devices" USING btree ("exit_node_id","tunnel_address") WHERE "devices"."revoked_at" is null;--> statement-breakpoint
UPDATE "devices" SET "revoked_at" = now() WHERE "revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_live_has_placement" CHECK ("devices"."revoked_at" is not null or ("devices"."region_id" is not null and "devices"."exit_node_id" is not null));--> statement-breakpoint
CREATE FUNCTION exit_nodes_refuse_live_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF EXISTS (SELECT 1 FROM "devices" WHERE exit_node_id = OLD.id AND revoked_at IS NULL) THEN
		RAISE EXCEPTION 'exit node % still serves a live device: revoke them before removing the node', OLD.id
			USING ERRCODE = 'restrict_violation';
	END IF;
	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER exit_nodes_no_live_delete
	BEFORE DELETE ON "exit_nodes"
	FOR EACH ROW
	EXECUTE FUNCTION exit_nodes_refuse_live_delete();--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE ON "regions", "exit_nodes" FROM "vpn_app";--> statement-breakpoint
CREATE FUNCTION live_addresses_on(node uuid) RETURNS SETOF text
	LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
	SELECT tunnel_address FROM "devices" WHERE exit_node_id = node AND revoked_at IS NULL;
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION live_addresses_on(uuid) TO "vpn_app", "app_system";
