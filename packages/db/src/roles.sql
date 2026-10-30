-- Least-privilege application roles. Run as the owner AFTER migrations (grants reference tables).
-- Passwords are substituted by roles.ts from LEDGER_READER_PASSWORD / LEDGER_APP_PASSWORD as
-- properly escaped literals (placeholders below). Roles are cluster-wide;
-- grants are per database. Idempotent.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_reader') THEN
    CREATE ROLE ledger_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ledger_app') THEN
    CREATE ROLE ledger_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
  END IF;
END
$$;

ALTER ROLE ledger_reader PASSWORD {{READER_PASSWORD}};
ALTER ROLE ledger_app PASSWORD {{APP_PASSWORD}};

-- Start from nothing.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ledger_reader, ledger_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ledger_reader, ledger_app;
REVOKE ALL ON SCHEMA public FROM ledger_reader, ledger_app;
GRANT USAGE ON SCHEMA public TO ledger_reader, ledger_app;

-- ledger_reader: read-only access to the ledger, nothing else.
GRANT SELECT ON TABLE public.transactions TO ledger_reader;

-- ledger_app: Better Auth tables (full DML) ...
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public."user", public.session, public.account, public.verification,
  public.organization, public.member, public.invitation
TO ledger_app;

-- ... and INSERT-only on the audit tables (no SELECT, UPDATE or DELETE: append-only).
GRANT INSERT ON TABLE public.ai_requests, public.ai_tool_calls TO ledger_app;
-- Conversation history: read + append only (no UPDATE/DELETE).
GRANT SELECT, INSERT ON TABLE public.ai_conversations, public.ai_messages TO ledger_app;
-- No sequences exist for these tables (uuid keys); no sequence grants are needed.

-- Database-level access: no PUBLIC CONNECT/TEMP on this database (so neither role can create
-- temp tables or reach other databases through PUBLIC); only the two roles may CONNECT here.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM ledger_reader, ledger_app', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ledger_reader, ledger_app', current_database());
END
$$;

-- Row-level security (defense in depth behind the repository's tenant_id = $1 filter).
-- Policies live here, not in drizzle migrations: drizzle's pgPolicy cannot express FORCE ROW
-- LEVEL SECURITY, and policies naming ledger_reader/ledger_app would fail in migrations because
-- the roles are created by this file after migrating. Session variables are set by the API per
-- transaction: set_config('app.tenant_id', ..., true) / set_config('app.user_id', ..., true).
-- An unset or empty variable makes the predicate NULL/false, so access fails closed (no rows).
-- The owner (superuser in compose) bypasses RLS: migrations and the seed are unaffected.
--
-- Not covered by RLS, deliberately:
--   * ai_requests / ai_tool_calls: ledger_app has INSERT only (no SELECT), so nothing can be read.
--   * Better Auth tables: authentication must look up users, sessions and members across tenants
--     before any tenant is known, so a tenant predicate cannot apply.
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.transactions;
CREATE POLICY tenant_isolation ON public.transactions FOR SELECT TO ledger_reader
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_conversations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_select ON public.ai_conversations;
DROP POLICY IF EXISTS owner_insert ON public.ai_conversations;
CREATE POLICY owner_select ON public.ai_conversations FOR SELECT TO ledger_app
  USING (tenant_id = current_setting('app.tenant_id', true) AND user_id = current_setting('app.user_id', true));
CREATE POLICY owner_insert ON public.ai_conversations FOR INSERT TO ledger_app
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) AND user_id = current_setting('app.user_id', true));

ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_select ON public.ai_messages;
DROP POLICY IF EXISTS owner_insert ON public.ai_messages;
CREATE POLICY owner_select ON public.ai_messages FOR SELECT TO ledger_app
  USING (tenant_id = current_setting('app.tenant_id', true) AND user_id = current_setting('app.user_id', true));
CREATE POLICY owner_insert ON public.ai_messages FOR INSERT TO ledger_app
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true) AND user_id = current_setting('app.user_id', true));
