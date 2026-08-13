ALTER TABLE "devices" ADD COLUMN "account_slot" integer;--> statement-breakpoint
UPDATE "devices" AS d
SET "account_slot" = s.slot
FROM (
	SELECT
		id,
		(
			row_number() OVER (
				PARTITION BY account_id
				ORDER BY (revoked_at IS NOT NULL), created_at, id
			) - 1
		)::int AS slot
	FROM "devices"
) AS s
WHERE d.id = s.id;--> statement-breakpoint
ALTER TABLE "devices" ALTER COLUMN "account_slot" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_live_account_slot_key" ON "devices" USING btree ("account_id","account_slot") WHERE "devices"."revoked_at" is null;
