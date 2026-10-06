-- Werkbank: defense in depth for future objects in schema werkbank (overrides the
-- broader defaults in 20261006140000_werkbank_schema.sql before any object exists).
-- Every new werkbank table MUST enable row level security (the schema is exposed through
-- the API); isolation.test.sql fails on any werkbank table without RLS.
-- Tables: authenticated gets SELECT only; each table grants insert/update/delete
-- explicitly next to its RLS policies. Functions: no default EXECUTE for authenticated;
-- each function revokes public and anon and grants execute explicitly
-- (enforced in supabase/tests/werkbank/isolation.test.sql).
-- Like 20261006140000, these defaults apply to objects created by the migrating role
-- (postgres via the Supabase integration and `supabase db reset`; pgTAP runs as the same
-- role, so isolation.test.sql exercises exactly these defaults). Werkbank migrations must
-- keep running as that role.
alter default privileges in schema werkbank
  revoke insert, update, delete on tables from authenticated;
-- This does not remove PUBLIC's built-in EXECUTE on new functions (per-schema default
-- privileges cannot revoke global defaults), hence the per-function revoke rule above.
alter default privileges in schema werkbank
  revoke execute on functions from authenticated;
