-- org_kinds: kinds are data. Behaviour flags drive catalog seeding (provision_org) and
-- whether an org admin may switch into / out of a kind (set_org_kind + guard trigger).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(12);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000b1','authenticated','authenticated','kinds-super@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000b2','authenticated','authenticated','kinds-admin@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.platform_admins (user_id) VALUES ('aaaaaaaa-0000-4000-a000-0000000000b1');
INSERT INTO public.app_settings (org_id, key, value) VALUES
  (NULL,'starter_catalog_template','{"skills":["Vocals"],"cities":[],"casts":[{"name":"Main Cast","description":null}]}'::jsonb)
ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value;
-- Org admin of two orgs: one production, one locked_test (inserted below, after the test kind).
SET session_replication_role = DEFAULT;

-- Test-only kind that neither seeds a catalog nor lets an org admin switch in or out.
INSERT INTO public.org_kinds (kind, seeds_starter_catalog, switchable_by_org_admin) VALUES ('locked_test', false, false);

SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000c1','Kinds Prod','kinds-prod','production'),
  ('bbbbbbbb-0000-4000-b000-0000000000c2','Kinds Locked','kinds-locked','locked_test');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000c1','aaaaaaaa-0000-4000-a000-0000000000b2','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000000c2','aaaaaaaa-0000-4000-a000-0000000000b2','admin');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

-- ── seeded kinds
SELECT results_eq(
  $$ SELECT kind, seeds_starter_catalog, switchable_by_org_admin FROM public.org_kinds
      WHERE kind IN ('production','staffing') ORDER BY kind $$,
  $$ VALUES ('production'::text, true, true), ('staffing'::text, true, true) $$,
  'production and staffing seed a catalog and are admin-switchable');

-- ── provision_org: catalog seeding follows the kind flag, unknown kind rejected
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.provision_org('A','a-prod','a@x.test','admin','production')$$, 'provision production org');
SELECT lives_ok($$SELECT public.provision_org('B','b-locked','b@x.test','admin','locked_test')$$, 'provision locked_test org');
SELECT throws_ok($$SELECT public.provision_org('C','c-circus','c@x.test','admin','circus')$$,
  '22023', NULL, 'unknown kind rejected by provision_org');
RESET ROLE;

SELECT cmp_ok(
  (SELECT count(*)::int FROM public.casts c JOIN public.organizations o ON o.id = c.org_id WHERE o.slug = 'a-prod'),
  '>', 0, 'production org gets starter catalog');
SELECT is(
  (SELECT count(*)::int FROM public.casts c JOIN public.organizations o ON o.id = c.org_id WHERE o.slug = 'b-locked'),
  0, 'locked_test org gets no starter catalog');

-- ── set_org_kind: switchable_by_org_admin gates org admins, not super-admins
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000b2');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_org_kind('bbbbbbbb-0000-4000-b000-0000000000c1','locked_test')$$,
  '42501', NULL, 'org admin cannot switch into a locked kind');
SELECT throws_ok($$SELECT public.set_org_kind('bbbbbbbb-0000-4000-b000-0000000000c2','production')$$,
  '42501', NULL, 'org admin cannot switch out of a locked kind');
SELECT lives_ok($$SELECT public.set_org_kind('bbbbbbbb-0000-4000-b000-0000000000c1','staffing')$$,
  'org admin can switch between switchable kinds');
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000b1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.set_org_kind('bbbbbbbb-0000-4000-b000-0000000000c1','locked_test')$$,
  'super-admin can switch into a locked kind');
SELECT lives_ok($$SELECT public.set_org_kind('bbbbbbbb-0000-4000-b000-0000000000c1','production')$$,
  'super-admin can switch out of a locked kind');
RESET ROLE;

-- ── the kind table itself is read-only for clients
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000b2');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO public.org_kinds (kind, seeds_starter_catalog, switchable_by_org_admin) VALUES ('x', true, true)$$,
  '42501', NULL, 'authenticated cannot insert org_kinds');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
