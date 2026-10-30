-- Runs once, on first start of an empty data volume (postgres image entrypoint).
-- POSTGRES_DB (demoledger) is created by the image itself; add the test database.
-- App roles (ledger_reader, ledger_app) are created by packages/db/src/roles.sql
-- during `pnpm db:reset`, because their passwords come from .env.
CREATE DATABASE demoledger_test;
