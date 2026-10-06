-- handwerk org kind: a locked kind (no starter catalog, not switchable by org admins).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000d1','authenticated','authenticated','hw-super@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000d2','authenticated','authenticated','hw-admin@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.platform_admins (user_id) VALUES ('aaaaaaaa-0000-4000-a000-0000000000d1');
INSERT INTO public.app_settings (org_id, key, value) VALUES
  (NULL,'starter_catalog_template','{"skills":["Vocals"],"cities":[],"casts":[{"name":"Main Cast","description":null}]}'::jsonb)
ON CONFLICT (org_id, key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000d1','HW Betrieb','hw-betrieb','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000d2','Prod Org','hw-prod','production');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000d1','aaaaaaaa-0000-4000-a000-0000000000d2','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000000d2','aaaaaaaa-0000-4000-a000-0000000000d2','admin');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

SELECT results_eq(
  $$ SELECT kind, seeds_starter_catalog, switchable_by_org_admin FROM public.org_kinds WHERE kind = 'handwerk' $$,
  $$ VALUES ('handwerk'::text, false, false) $$,
  'handwerk is registered: no starter catalog, not switchable by org admins');

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000d1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT public.provision_org('HW Neu','hw-neu','hw@x.test','admin','handwerk')$$,
  'super-admin provisions a handwerk org');
RESET ROLE;

SELECT is(
  (SELECT count(*)::int FROM public.casts c JOIN public.organizations o ON o.id = c.org_id WHERE o.slug = 'hw-neu'),
  0, 'a handwerk org gets no starter casts');
SELECT is(
  (SELECT org_kind FROM public.organizations WHERE slug = 'hw-neu'),
  'handwerk', 'the provisioned org has the handwerk kind');

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000d2');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT public.set_org_kind('bbbbbbbb-0000-4000-b000-0000000000d1','production')$$,
  '42501', NULL, 'org admin cannot switch a handwerk org to production');
SELECT throws_ok($$SELECT public.set_org_kind('bbbbbbbb-0000-4000-b000-0000000000d2','handwerk')$$,
  '42501', NULL, 'org admin cannot switch a production org to handwerk');
-- A direct table update cannot bypass set_org_kind: RLS lets only super-admins write
-- organizations, and the guard trigger would reject the change anyway.
SELECT lives_ok(
  $$UPDATE public.organizations SET org_kind = 'production' WHERE id = 'bbbbbbbb-0000-4000-b000-0000000000d1'$$,
  'a direct update by an org admin runs without error');
RESET ROLE;
SELECT is(
  (SELECT org_kind FROM public.organizations WHERE id = 'bbbbbbbb-0000-4000-b000-0000000000d1'),
  'handwerk', 'the direct update by an org admin leaves the handwerk kind unchanged');

-- A client request without a user (anon, auth.uid() is null) cannot use the trigger's
-- null-uid pass-through: RLS gives anon no write access to organizations, and
-- set_org_kind is not executable by anon.
SELECT set_config('request.jwt.claims', '{"role":"anon"}', true);
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT public.set_org_kind('bbbbbbbb-0000-4000-b000-0000000000d1','production')$$,
  '42501', NULL, 'anon cannot call set_org_kind');
UPDATE public.organizations SET org_kind = 'production' WHERE id = 'bbbbbbbb-0000-4000-b000-0000000000d1';
RESET ROLE;
SELECT is(
  (SELECT org_kind FROM public.organizations WHERE id = 'bbbbbbbb-0000-4000-b000-0000000000d1'),
  'handwerk', 'a direct update without a user leaves the handwerk kind unchanged');

SELECT * FROM finish();
ROLLBACK;
