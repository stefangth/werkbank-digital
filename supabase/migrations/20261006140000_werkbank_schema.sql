-- Werkbank plugin: the dedicated schema for its tables. Removal is
-- `drop schema werkbank cascade`; nothing in `public` may depend on it (see
-- supabase/tests/werkbank/isolation.test.sql). Teil 1 creates no tables here; the
-- default privileges below mean Teil 2 tables and functions need no extra grants.
create schema werkbank;

grant usage on schema werkbank to authenticated, service_role;

alter default privileges in schema werkbank
  grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema werkbank
  grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema werkbank
  grant execute on functions to authenticated, service_role;
