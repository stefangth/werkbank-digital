-- Werkbank: defense in depth for future objects in schema werkbank (overrides the
-- broader defaults in 20261006140000_werkbank_schema.sql before any object exists).
-- Every new werkbank table MUST enable row level security (the schema is exposed through
-- the API); isolation.test.sql fails on any werkbank table without RLS.
-- Tables: authenticated gets SELECT only; each table grants insert/update/delete
-- explicitly next to its RLS policies. Functions: no default EXECUTE for authenticated;
-- each function revokes public and anon and grants execute explicitly
-- (enforced in supabase/tests/werkbank/isolation.test.sql).
alter default privileges in schema werkbank
  revoke insert, update, delete on tables from authenticated;
alter default privileges in schema werkbank
  revoke execute on functions from authenticated;
