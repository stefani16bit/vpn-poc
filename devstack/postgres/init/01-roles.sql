-- Roles only. The schema arrives via Drizzle migrations, not here.
--
-- Multi-tenancy/RLS is out of scope for this phase, but the role split is not:
-- connecting the application as `postgres` is the decision that is expensive to
-- undo later, because every policy written afterwards reads as correct while a
-- superuser silently ignores it. See docs/03-DECISION-LOG.md DEC-005.
--
-- No CREATE EXTENSION: PostgreSQL 17 has gen_random_uuid() in core.

CREATE ROLE vpn_migrator LOGIN PASSWORD 'vpn_migrator_dev' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE vpn_app LOGIN PASSWORD 'vpn_app_dev' NOSUPERUSER NOBYPASSRLS NOINHERIT;
CREATE ROLE app_system NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE vpn_readonly LOGIN PASSWORD 'vpn_readonly_dev' NOSUPERUSER BYPASSRLS;
CREATE ROLE vpn_admin LOGIN PASSWORD 'vpn_admin_dev' NOSUPERUSER BYPASSRLS;

GRANT CONNECT ON DATABASE poc_vpn_dev TO vpn_migrator, vpn_app, vpn_readonly, vpn_admin;

-- CREATE on the database, not just on public: Drizzle keeps its migration
-- ledger in a `drizzle` schema it creates on first run, and without this the
-- very first migration fails with a bare permission-denied that points at
-- aclchk.c rather than at the missing grant.
GRANT CREATE ON DATABASE poc_vpn_dev TO vpn_migrator;

ALTER SCHEMA public OWNER TO vpn_migrator;
GRANT USAGE ON SCHEMA public TO vpn_app, app_system, vpn_readonly, vpn_admin;

-- app_system is the future grantee of job-bypass policies. vpn_app holds the
-- membership but NOINHERIT means it does not pick the privileges up
-- automatically: a worker has to SET ROLE app_system on purpose, so an ordinary
-- request can never acquire the bypass by accident. Policy role matching goes
-- through has_privs_of_role, which is exactly what NOINHERIT switches off.
GRANT app_system TO vpn_app;

ALTER DEFAULT PRIVILEGES FOR ROLE vpn_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vpn_app, app_system;
ALTER DEFAULT PRIVILEGES FOR ROLE vpn_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO vpn_app, app_system;

-- Read-only tooling (psql, a DB MCP server) needs to see everything to be
-- useful. BYPASSRLS is safe here only because the grant never includes a write.
ALTER DEFAULT PRIVILEGES FOR ROLE vpn_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO vpn_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE vpn_migrator IN SCHEMA public
  GRANT SELECT ON SEQUENCES TO vpn_readonly;

-- A human at a GUI, and nothing else. It is deliberately not the schema owner:
-- browsing as `vpn_migrator` puts hand-typed DDL under the identity that owns
-- the migration history, and drift there reads as schema rather than as a typo.
-- TRUNCATE is the one privilege it holds that `vpn_app` does not, and that gap
-- is the tell: a test that needs this role is asserting against privileges the
-- application will never have. See DEC-005.
ALTER DEFAULT PRIVILEGES FOR ROLE vpn_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO vpn_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE vpn_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO vpn_admin;
