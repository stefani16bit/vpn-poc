CREATE FUNCTION devices_refuse_live_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'device % is live: revoke it before deleting the row, or the exit node keeps serving its peer', OLD.id
		USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER devices_no_live_delete
	BEFORE DELETE ON "devices"
	FOR EACH ROW
	WHEN (OLD.revoked_at IS NULL)
	EXECUTE FUNCTION devices_refuse_live_delete();
