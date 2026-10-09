-- Werkbank Teil 6a (R1): visit_reports and visit_report_photos (constraints, lock trigger, RLS,
-- column grant), orders.completed_by set by order_transition(), and order_list.completed_by_technician.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(49);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000006a1','authenticated','authenticated','vr-admin-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000006a2','authenticated','authenticated','vr-producer-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000006a3','authenticated','authenticated','vr-tech-a@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a1','VR Org A','vr-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000006a2','VR Org B','vr-org-b','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a1','aaaaaaaa-0000-4000-a000-0000000006a1','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000006a1','aaaaaaaa-0000-4000-a000-0000000006a2','producer'),
  ('bbbbbbbb-0000-4000-b000-0000000006a1','aaaaaaaa-0000-4000-a000-0000000006a3','artist');
INSERT INTO public.artists (id, org_id, user_id, name) VALUES
  ('99999999-0000-4000-9000-0000000006a1','bbbbbbbb-0000-4000-b000-0000000006a1','aaaaaaaa-0000-4000-a000-0000000006a3','Tina Technik');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, last_name, street, postal_code, city) VALUES
  ('cccccccc-0000-4000-c000-0000000006a1','bbbbbbbb-0000-4000-b000-0000000006a1','K-1','private','Eins','Weg 1','01067','Dresden'),
  ('cccccccc-0000-4000-c000-0000000006a2','bbbbbbbb-0000-4000-b000-0000000006a2','K-1','private','Zwei','Weg 2','01067','Dresden');
-- o1 open (reports), o2 cancelled, o3 in progress (transitions), o4 invoiced, o5 open in org B.
INSERT INTO werkbank.orders (id, org_id, order_no, customer_id, subject, status) VALUES
  ('33333333-0000-4000-a000-0000000006a1','bbbbbbbb-0000-4000-b000-0000000006a1','AU-1','cccccccc-0000-4000-c000-0000000006a1','Bad','open'),
  ('33333333-0000-4000-a000-0000000006a2','bbbbbbbb-0000-4000-b000-0000000006a1','AU-2','cccccccc-0000-4000-c000-0000000006a1','Küche','cancelled'),
  ('33333333-0000-4000-a000-0000000006a3','bbbbbbbb-0000-4000-b000-0000000006a1','AU-3','cccccccc-0000-4000-c000-0000000006a1','Dach','in_progress'),
  ('33333333-0000-4000-a000-0000000006a4','bbbbbbbb-0000-4000-b000-0000000006a1','AU-4','cccccccc-0000-4000-c000-0000000006a1','Keller','invoiced'),
  ('33333333-0000-4000-a000-0000000006a5','bbbbbbbb-0000-4000-b000-0000000006a2','AU-1','cccccccc-0000-4000-c000-0000000006a2','Flur','open');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

-- Schema --------------------------------------------------------------------------------
SELECT has_table('werkbank', 'visit_reports', 'werkbank.visit_reports exists');
SELECT has_table('werkbank', 'visit_report_photos', 'werkbank.visit_report_photos exists');
SELECT has_column('werkbank', 'orders', 'completed_by', 'werkbank.orders has completed_by');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'werkbank.visit_reports'::regclass),
  'RLS is enabled on visit_reports');
SELECT ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'werkbank.visit_report_photos'::regclass),
  'RLS is enabled on visit_report_photos');

-- Fixture reports (owner context): r1 gets a photo and is then locked; r2 empty; r3 with body;
-- r4 empty with a photo.
INSERT INTO werkbank.visit_reports (id, org_id, order_id, artist_id, technician_name, body) VALUES
  ('55555555-0000-4000-a000-0000000006a1','bbbbbbbb-0000-4000-b000-0000000006a1','33333333-0000-4000-a000-0000000006a1',
   '99999999-0000-4000-9000-0000000006a1','Tina Technik','Befund'),
  ('55555555-0000-4000-a000-0000000006a2','bbbbbbbb-0000-4000-b000-0000000006a1','33333333-0000-4000-a000-0000000006a1',
   '99999999-0000-4000-9000-0000000006a1','Tina Technik',''),
  ('55555555-0000-4000-a000-0000000006a3','bbbbbbbb-0000-4000-b000-0000000006a1','33333333-0000-4000-a000-0000000006a1',
   '99999999-0000-4000-9000-0000000006a1','Tina Technik','Text'),
  ('55555555-0000-4000-a000-0000000006a4','bbbbbbbb-0000-4000-b000-0000000006a1','33333333-0000-4000-a000-0000000006a1',
   '99999999-0000-4000-9000-0000000006a1','Tina Technik','');
SELECT lives_ok($$INSERT INTO werkbank.visit_report_photos (id, org_id, report_id, path, position) VALUES
  ('66666666-0000-4000-a000-0000000006a1','bbbbbbbb-0000-4000-b000-0000000006a1','55555555-0000-4000-a000-0000000006a1','a/o/r1/1.jpg',0),
  ('66666666-0000-4000-a000-0000000006a4','bbbbbbbb-0000-4000-b000-0000000006a1','55555555-0000-4000-a000-0000000006a4','a/o/r4/1.jpg',0)$$,
  'a photo is added to an unlocked report');
SELECT is((SELECT visit_date FROM werkbank.visit_reports WHERE id = '55555555-0000-4000-a000-0000000006a1'),
  (now() AT TIME ZONE 'Europe/Berlin')::date, 'visit_date defaults to the Berlin date');
SELECT lives_ok($$UPDATE werkbank.visit_reports SET locked_at = now() WHERE id = '55555555-0000-4000-a000-0000000006a1'$$,
  'an unlocked report can be locked');

-- Constraints ---------------------------------------------------------------------------
SELECT throws_ok($$INSERT INTO werkbank.visit_reports (org_id, order_id, technician_name) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a1','33333333-0000-4000-a000-0000000006a2','X')$$,
  '55000', 'order_closed', 'no report on a cancelled order');
SELECT throws_ok($$INSERT INTO werkbank.visit_reports (org_id, order_id, technician_name) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a1','33333333-0000-4000-a000-0000000006a4','X')$$,
  '55000', 'order_closed', 'no report on an invoiced order');
SELECT throws_like($$INSERT INTO werkbank.visit_reports (org_id, order_id, technician_name) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a1','33333333-0000-4000-a000-0000000006a5','X')$$,
  '%visit_reports_order_fk%', 'a report cannot point at an order of another org');
SELECT throws_like($$INSERT INTO werkbank.visit_reports (org_id, order_id, technician_name, signer_name) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a1','33333333-0000-4000-a000-0000000006a1','X','Kunde')$$,
  '%visit_reports_signature_all_or_none%', 'signer_name without signature_path is rejected');
SELECT throws_like($$INSERT INTO werkbank.visit_reports (org_id, order_id, technician_name, signer_name, signature_path, signed_at) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a1','33333333-0000-4000-a000-0000000006a1','X','Kunde','a/o/r/signature.png',now())$$,
  '%visit_reports_signed_is_locked%', 'signed_at without locked_at is rejected');
SELECT lives_ok($$INSERT INTO werkbank.visit_reports (org_id, order_id, technician_name, signer_name, signature_path, signed_at, locked_at) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a1','33333333-0000-4000-a000-0000000006a1','X','Kunde','a/o/r/signature.png',now(),now())$$,
  'a signed, locked report is accepted');
SELECT throws_ok($$INSERT INTO werkbank.visit_reports (org_id, order_id, technician_name, body) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a1','33333333-0000-4000-a000-0000000006a1','X',repeat('x', 10001))$$,
  '23514', NULL, 'body is limited to 10 000 characters');
SELECT throws_ok($$INSERT INTO werkbank.visit_report_photos (org_id, report_id, path, position, caption) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a1','55555555-0000-4000-a000-0000000006a2','a/o/r2/1.jpg',0,repeat('x', 201))$$,
  '23514', NULL, 'caption is limited to 200 characters');
SELECT throws_ok($$INSERT INTO werkbank.visit_report_photos (org_id, report_id, path, position) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a1','55555555-0000-4000-a000-0000000006a2','a/o/r1/1.jpg',0)$$,
  '23505', NULL, 'a photo path is unique');

-- Lock trigger (owner context) -----------------------------------------------------------
SELECT throws_ok($$UPDATE werkbank.visit_reports SET body = 'y' WHERE id = '55555555-0000-4000-a000-0000000006a1'$$,
  '55000', 'report_locked', 'the body of a locked report cannot change');
SELECT throws_ok($$UPDATE werkbank.visit_reports SET locked_at = NULL WHERE id = '55555555-0000-4000-a000-0000000006a1'$$,
  '55000', 'report_locked', 'a locked report cannot be unlocked');
SELECT lives_ok($$UPDATE werkbank.visit_reports SET office_note = 'intern' WHERE id = '55555555-0000-4000-a000-0000000006a1'$$,
  'office_note of a locked report can change');
SELECT throws_ok($$INSERT INTO werkbank.visit_report_photos (org_id, report_id, path, position) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a1','55555555-0000-4000-a000-0000000006a1','a/o/r1/2.jpg',1)$$,
  '55000', 'report_locked', 'no photo is added to a locked report');
SELECT throws_ok($$UPDATE werkbank.visit_report_photos SET caption = 'neu' WHERE id = '66666666-0000-4000-a000-0000000006a1'$$,
  '55000', 'report_locked', 'a photo of a locked report cannot change');
SELECT throws_ok($$DELETE FROM werkbank.visit_report_photos WHERE id = '66666666-0000-4000-a000-0000000006a1'$$,
  '55000', 'report_locked', 'a photo of a locked report cannot be deleted');
SELECT throws_ok($$DELETE FROM werkbank.visit_reports WHERE id = '55555555-0000-4000-a000-0000000006a1'$$,
  '55000', 'report_locked', 'a locked report cannot be deleted');
SELECT throws_ok($$DELETE FROM werkbank.visit_reports WHERE id = '55555555-0000-4000-a000-0000000006a3'$$,
  '55000', 'report_not_empty', 'an unlocked report with a body cannot be deleted');
SELECT throws_ok($$DELETE FROM werkbank.visit_reports WHERE id = '55555555-0000-4000-a000-0000000006a4'$$,
  '55000', 'report_not_empty', 'an unlocked report with a photo cannot be deleted');
SELECT lives_ok($$DELETE FROM werkbank.visit_reports WHERE id = '55555555-0000-4000-a000-0000000006a2'$$,
  'an unlocked empty report can be deleted');

-- Deleting an order with reports fails on the FK.
SELECT throws_like($$DELETE FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000006a1'$$,
  '%visit_reports_order_fk%', 'an order with reports cannot be deleted');

-- RLS and grants ------------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006a2');
SET LOCAL ROLE authenticated;
SELECT isnt_empty($$SELECT 1 FROM werkbank.visit_reports WHERE id = '55555555-0000-4000-a000-0000000006a1'$$,
  'the office (producer) sees a report');
SELECT isnt_empty($$SELECT 1 FROM werkbank.visit_report_photos WHERE id = '66666666-0000-4000-a000-0000000006a1'$$,
  'the office (producer) sees a photo');
SELECT throws_ok($$INSERT INTO werkbank.visit_reports (org_id, order_id, technician_name) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a1','33333333-0000-4000-a000-0000000006a1','X')$$,
  '42501', NULL, 'authenticated has no insert grant on visit_reports');
SELECT throws_ok($$INSERT INTO werkbank.visit_report_photos (org_id, report_id, path, position) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a1','55555555-0000-4000-a000-0000000006a3','a/o/r3/1.jpg',0)$$,
  '42501', NULL, 'authenticated has no insert grant on visit_report_photos');
SELECT lives_ok($$UPDATE werkbank.visit_reports SET office_note = 'x' WHERE id = '55555555-0000-4000-a000-0000000006a1'$$,
  'the office may update office_note');
RESET ROLE;
SELECT is((SELECT office_note FROM werkbank.visit_reports WHERE id = '55555555-0000-4000-a000-0000000006a1'), 'x',
  'the office updates office_note on a locked report');
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006a2');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$UPDATE werkbank.visit_reports SET body = 'y' WHERE id = '55555555-0000-4000-a000-0000000006a3'$$,
  '42501', NULL, 'the column grant limits office updates to office_note');
SELECT throws_ok($$DELETE FROM werkbank.visit_reports WHERE id = '55555555-0000-4000-a000-0000000006a3'$$,
  '42501', NULL, 'authenticated has no delete grant on visit_reports');
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006a3');
SET LOCAL ROLE authenticated;
SELECT is_empty($$SELECT 1 FROM werkbank.visit_reports$$, 'a technician reads no report directly');
SELECT is_empty($$SELECT 1 FROM werkbank.visit_report_photos$$, 'a technician reads no photo directly');
RESET ROLE;

-- completed_by ----------------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006a3');
UPDATE werkbank.orders SET status = 'done' WHERE id = '33333333-0000-4000-a000-0000000006a3';
SELECT is((SELECT completed_by FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000006a3'),
  'aaaaaaaa-0000-4000-a000-0000000006a3'::uuid, 'in_progress -> done sets completed_by to the caller');
SELECT is((SELECT completed_by_technician FROM werkbank.order_list WHERE id = '33333333-0000-4000-a000-0000000006a3'),
  true, 'order_list.completed_by_technician is true when a technician of the org completed the order');
SELECT is((SELECT completed_by_technician FROM werkbank.order_list WHERE id = '33333333-0000-4000-a000-0000000006a1'),
  false, 'order_list.completed_by_technician is false without completed_by');
SELECT lives_ok($$UPDATE werkbank.orders SET completed_by = 'aaaaaaaa-0000-4000-a000-0000000006a2' WHERE id = '33333333-0000-4000-a000-0000000006a3'$$,
  'completed_by is not a lock-breaking change on a done order');
SELECT is((SELECT completed_by FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000006a3'),
  'aaaaaaaa-0000-4000-a000-0000000006a3'::uuid, 'a direct write to completed_by is ignored');
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006a2');
UPDATE werkbank.orders SET status = 'in_progress' WHERE id = '33333333-0000-4000-a000-0000000006a3';
SELECT is((SELECT completed_by FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000006a3'),
  NULL, 'done -> in_progress clears completed_by');
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006a3');
UPDATE werkbank.orders SET status = 'done' WHERE id = '33333333-0000-4000-a000-0000000006a3';
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006a2');
UPDATE werkbank.orders SET status = 'invoiced' WHERE id = '33333333-0000-4000-a000-0000000006a3';
SELECT is((SELECT completed_by FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000006a3'),
  'aaaaaaaa-0000-4000-a000-0000000006a3'::uuid, 'done -> invoiced keeps completed_by');

-- FK set-null actions pass the triggers: deleting the user clears completed_by on the invoiced
-- order, deleting the artist clears the author of the locked report.
SELECT lives_ok($$DELETE FROM auth.users WHERE id = 'aaaaaaaa-0000-4000-a000-0000000006a3'$$,
  'the user who completed an invoiced order can be deleted');
SELECT is((SELECT completed_by FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000006a3'),
  NULL, 'deleting the user sets completed_by to null');
SELECT lives_ok($$DELETE FROM public.artists WHERE id = '99999999-0000-4000-9000-0000000006a1'$$,
  'the author of a locked report can be deleted');

-- An org delete cascades through locked reports and their photos.
INSERT INTO werkbank.visit_reports (id, org_id, order_id, technician_name, body) VALUES
  ('55555555-0000-4000-a000-0000000006b1','bbbbbbbb-0000-4000-b000-0000000006a2','33333333-0000-4000-a000-0000000006a5','X','Befund');
INSERT INTO werkbank.visit_report_photos (org_id, report_id, path, position) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006a2','55555555-0000-4000-a000-0000000006b1','b/o/r/1.jpg',0);
UPDATE werkbank.visit_reports SET locked_at = now() WHERE id = '55555555-0000-4000-a000-0000000006b1';
SELECT lives_ok($$DELETE FROM public.organizations WHERE id = 'bbbbbbbb-0000-4000-b000-0000000006a2'$$,
  'an org delete cascades through a locked report with photos');

SELECT * FROM finish();
ROLLBACK;
