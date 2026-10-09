-- Werkbank Teil 6a review fixes (20261008190000): my_assignment lists the co-technicians without
-- the caller, and the reports newest first.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(5);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000006f1','authenticated','authenticated','vf-tech-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000006f2','authenticated','authenticated','vf-tech-b@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000006f3','authenticated','authenticated','vf-tech-c@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006f1','VF Org','vf-org','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006f1','aaaaaaaa-0000-4000-a000-0000000006f1','artist'),
  ('bbbbbbbb-0000-4000-b000-0000000006f1','aaaaaaaa-0000-4000-a000-0000000006f2','artist'),
  ('bbbbbbbb-0000-4000-b000-0000000006f1','aaaaaaaa-0000-4000-a000-0000000006f3','artist');
INSERT INTO public.artists (id, org_id, user_id, name) VALUES
  ('99999999-0000-4000-9000-0000000006f1','bbbbbbbb-0000-4000-b000-0000000006f1','aaaaaaaa-0000-4000-a000-0000000006f1','Anna Alpha'),
  ('99999999-0000-4000-9000-0000000006f2','bbbbbbbb-0000-4000-b000-0000000006f1','aaaaaaaa-0000-4000-a000-0000000006f2','Bruno Beta'),
  ('99999999-0000-4000-9000-0000000006f3','bbbbbbbb-0000-4000-b000-0000000006f1','aaaaaaaa-0000-4000-a000-0000000006f3','Cleo Gamma');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, last_name, street, postal_code, city) VALUES
  ('cccccccc-0000-4000-c000-0000000006f1','bbbbbbbb-0000-4000-b000-0000000006f1','K-1','private','Eins','Kundenweg 1','01067','Dresden');
INSERT INTO werkbank.orders (id, org_id, order_no, customer_id, subject, status, scheduled_date, discount_percent) VALUES
  ('33333333-0000-4000-a000-0000000006f1','bbbbbbbb-0000-4000-b000-0000000006f1','AU-1','cccccccc-0000-4000-c000-0000000006f1','Bad','open',
   (now() AT TIME ZONE 'Europe/Berlin')::date, 0);
INSERT INTO werkbank.order_technicians (org_id, order_id, artist_id) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006f1','33333333-0000-4000-a000-0000000006f1','99999999-0000-4000-9000-0000000006f1'),
  ('bbbbbbbb-0000-4000-b000-0000000006f1','33333333-0000-4000-a000-0000000006f1','99999999-0000-4000-9000-0000000006f2'),
  ('bbbbbbbb-0000-4000-b000-0000000006f1','33333333-0000-4000-a000-0000000006f1','99999999-0000-4000-9000-0000000006f3');
-- Two reports on the same day (created apart) and one older: newest first is r3, r2, r1.
INSERT INTO werkbank.visit_reports (id, org_id, order_id, artist_id, technician_name, visit_date, created_at) VALUES
  ('44444444-0000-4000-a000-0000000006f1','bbbbbbbb-0000-4000-b000-0000000006f1','33333333-0000-4000-a000-0000000006f1',
   '99999999-0000-4000-9000-0000000006f1','Anna Alpha','2026-10-01', now() - interval '1 hour'),
  ('44444444-0000-4000-a000-0000000006f2','bbbbbbbb-0000-4000-b000-0000000006f1','33333333-0000-4000-a000-0000000006f1',
   '99999999-0000-4000-9000-0000000006f2','Bruno Beta','2026-10-05', now() - interval '2 hours'),
  ('44444444-0000-4000-a000-0000000006f3','bbbbbbbb-0000-4000-b000-0000000006f1','33333333-0000-4000-a000-0000000006f1',
   '99999999-0000-4000-9000-0000000006f1','Anna Alpha','2026-10-05', now() - interval '1 hour');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006f1');
SET LOCAL ROLE authenticated;
SELECT is((werkbank.my_assignment('33333333-0000-4000-a000-0000000006f1')) -> 'technicians', '["Bruno Beta","Cleo Gamma"]'::jsonb,
  'my_assignment: the co-technicians, never the caller');
SELECT is(
  (SELECT jsonb_agg(r -> 'id') FROM jsonb_array_elements(werkbank.my_assignment('33333333-0000-4000-a000-0000000006f1') -> 'reports') r),
  '["44444444-0000-4000-a000-0000000006f3","44444444-0000-4000-a000-0000000006f2","44444444-0000-4000-a000-0000000006f1"]'::jsonb,
  'my_assignment: reports newest first (visit date, then created)');
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006f2');
SET LOCAL ROLE authenticated;
SELECT is((werkbank.my_assignment('33333333-0000-4000-a000-0000000006f1')) -> 'technicians', '["Anna Alpha","Cleo Gamma"]'::jsonb,
  'my_assignment: another caller sees the first technician as a co-technician');
RESET ROLE;

-- A technician alone on the order has no co-technicians.
DELETE FROM werkbank.order_technicians WHERE artist_id <> '99999999-0000-4000-9000-0000000006f3';
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006f3');
SET LOCAL ROLE authenticated;
SELECT is((werkbank.my_assignment('33333333-0000-4000-a000-0000000006f1')) -> 'technicians', '[]'::jsonb,
  'my_assignment: no co-technicians when alone on the order');
RESET ROLE;

SELECT ok(NOT has_function_privilege('anon', 'werkbank.my_assignment(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'werkbank.my_assignment(uuid)', 'EXECUTE'),
  'my_assignment stays executable by authenticated only');

SELECT * FROM finish();
ROLLBACK;
