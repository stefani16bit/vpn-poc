CREATE VIEW "public"."live_tunnel_addresses" AS (select "tunnel_address" from "devices" where "devices"."revoked_at" is null);--> statement-breakpoint
GRANT SELECT ON "public"."live_tunnel_addresses" TO "vpn_app", "app_system";
