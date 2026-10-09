-- Werkbank Teil 6a (R2, R3): technician RPCs, the completion notification, the werkbank-visits
-- bucket and its storage policies.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(139);

SET LOCAL timezone = 'UTC';
-- Berlin today, as the RPCs compute it.
SELECT set_config('wbt.today', ((now() AT TIME ZONE 'Europe/Berlin')::date)::text, true);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000006c1','authenticated','authenticated','vl-admin@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000006c2','authenticated','authenticated','vl-producer@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000006c3','authenticated','authenticated','vl-tech-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000006c4','authenticated','authenticated','vl-tech-b@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000006c5','authenticated','authenticated','vl-tech-c@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006c1','VL Org 1','vl-org-1','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000006c2','VL Org 2','vl-org-2','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006c1','aaaaaaaa-0000-4000-a000-0000000006c1','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000006c1','aaaaaaaa-0000-4000-a000-0000000006c2','producer'),
  ('bbbbbbbb-0000-4000-b000-0000000006c1','aaaaaaaa-0000-4000-a000-0000000006c3','artist'),
  ('bbbbbbbb-0000-4000-b000-0000000006c1','aaaaaaaa-0000-4000-a000-0000000006c4','artist'),
  ('bbbbbbbb-0000-4000-b000-0000000006c2','aaaaaaaa-0000-4000-a000-0000000006c5','artist');
-- A and B are technicians of org 1, C of org 2.
INSERT INTO public.artists (id, org_id, user_id, name) VALUES
  ('99999999-0000-4000-9000-0000000006c1','bbbbbbbb-0000-4000-b000-0000000006c1','aaaaaaaa-0000-4000-a000-0000000006c3','Tina Technik'),
  ('99999999-0000-4000-9000-0000000006c2','bbbbbbbb-0000-4000-b000-0000000006c1','aaaaaaaa-0000-4000-a000-0000000006c4','Bernd Bau'),
  ('99999999-0000-4000-9000-0000000006c3','bbbbbbbb-0000-4000-b000-0000000006c2','aaaaaaaa-0000-4000-a000-0000000006c5','Carla Clever');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, last_name, street, postal_code, city) VALUES
  ('cccccccc-0000-4000-c000-0000000006c1','bbbbbbbb-0000-4000-b000-0000000006c1','K-1','private','Eins','Kundenweg 1','01067','Dresden'),
  ('cccccccc-0000-4000-c000-0000000006c2','bbbbbbbb-0000-4000-b000-0000000006c2','K-1','private','Zwei','Weg 2','01067','Dresden');
INSERT INTO werkbank.properties (id, org_id, customer_id, name, street, postal_code, city) VALUES
  ('dddddddd-0000-4000-d000-0000000006c1','bbbbbbbb-0000-4000-b000-0000000006c1','cccccccc-0000-4000-c000-0000000006c1','Haus','Hausweg 5','01069','Dresden');
INSERT INTO werkbank.contacts (id, org_id, customer_id, first_name, last_name, phone, mobile, email) VALUES
  ('eeeeeeee-0000-4000-e000-0000000006c1','bbbbbbbb-0000-4000-b000-0000000006c1','cccccccc-0000-4000-c000-0000000006c1','Karl','Kontakt','0351 1','0170 1','karl@example.com');
-- AU-1 overdue, AU-2 today, AU-3 in 7 days, AU-4 in 8 days, AU-5 unscheduled, AU-6 done 3 days ago,
-- AU-7 done 20 days ago, AU-8 cancelled, AU-9 the report order (in 3 days), AU-10 assigned to B only.
INSERT INTO werkbank.orders (id, org_id, order_no, customer_id, property_id, contact_id, subject, status,
  scheduled_date, scheduled_time, completed_at, location_note, notes, discount_percent) VALUES
  ('33333333-0000-4000-a000-0000000006c1','bbbbbbbb-0000-4000-b000-0000000006c1','AU-1','cccccccc-0000-4000-c000-0000000006c1',NULL,NULL,'Bad','open',
   current_setting('wbt.today')::date - 2, NULL, NULL, NULL, NULL, 0),
  ('33333333-0000-4000-a000-0000000006c2','bbbbbbbb-0000-4000-b000-0000000006c1','AU-2','cccccccc-0000-4000-c000-0000000006c1',NULL,NULL,'Küche','open',
   current_setting('wbt.today')::date, '08:00', NULL, NULL, NULL, 0),
  ('33333333-0000-4000-a000-0000000006c3','bbbbbbbb-0000-4000-b000-0000000006c1','AU-3','cccccccc-0000-4000-c000-0000000006c1',NULL,NULL,'Dach','open',
   current_setting('wbt.today')::date + 7, NULL, NULL, NULL, NULL, 0),
  ('33333333-0000-4000-a000-0000000006c4','bbbbbbbb-0000-4000-b000-0000000006c1','AU-4','cccccccc-0000-4000-c000-0000000006c1',NULL,NULL,'Keller','open',
   current_setting('wbt.today')::date + 8, NULL, NULL, NULL, NULL, 0),
  ('33333333-0000-4000-a000-0000000006c5','bbbbbbbb-0000-4000-b000-0000000006c1','AU-5','cccccccc-0000-4000-c000-0000000006c1',NULL,NULL,'Flur','open',
   NULL, NULL, NULL, NULL, NULL, 0),
  ('33333333-0000-4000-a000-0000000006c6','bbbbbbbb-0000-4000-b000-0000000006c1','AU-6','cccccccc-0000-4000-c000-0000000006c1',NULL,NULL,'Garten','done',
   current_setting('wbt.today')::date - 5, NULL, now() - interval '3 days', NULL, NULL, 0),
  ('33333333-0000-4000-a000-0000000006c7','bbbbbbbb-0000-4000-b000-0000000006c1','AU-7','cccccccc-0000-4000-c000-0000000006c1',NULL,NULL,'Zaun','done',
   current_setting('wbt.today')::date - 25, NULL, now() - interval '20 days', NULL, NULL, 0),
  ('33333333-0000-4000-a000-0000000006c8','bbbbbbbb-0000-4000-b000-0000000006c1','AU-8','cccccccc-0000-4000-c000-0000000006c1',NULL,NULL,'Tor','cancelled',
   current_setting('wbt.today')::date, NULL, NULL, NULL, NULL, 0),
  ('33333333-0000-4000-a000-0000000006c9','bbbbbbbb-0000-4000-b000-0000000006c1','AU-9','cccccccc-0000-4000-c000-0000000006c1',
   'dddddddd-0000-4000-d000-0000000006c1','eeeeeeee-0000-4000-e000-0000000006c1','Heizung','open',
   current_setting('wbt.today')::date + 3, '10:30', NULL, 'Schlüssel beim Nachbarn', 'Bitte Schuhe aus', 10),
  ('33333333-0000-4000-a000-0000000006ca','bbbbbbbb-0000-4000-b000-0000000006c1','AU-10','cccccccc-0000-4000-c000-0000000006c1',NULL,NULL,'Treppe','open',
   current_setting('wbt.today')::date, NULL, NULL, NULL, NULL, 0),
  ('33333333-0000-4000-a000-0000000006cb','bbbbbbbb-0000-4000-b000-0000000006c2','AU-1','cccccccc-0000-4000-c000-0000000006c2',NULL,NULL,'Fenster','open',
   current_setting('wbt.today')::date, NULL, NULL, NULL, NULL, 0);
INSERT INTO werkbank.order_technicians (org_id, order_id, artist_id)
SELECT 'bbbbbbbb-0000-4000-b000-0000000006c1', o, '99999999-0000-4000-9000-0000000006c1'::uuid
FROM unnest(ARRAY['33333333-0000-4000-a000-0000000006c1','33333333-0000-4000-a000-0000000006c2','33333333-0000-4000-a000-0000000006c3',
  '33333333-0000-4000-a000-0000000006c4','33333333-0000-4000-a000-0000000006c5','33333333-0000-4000-a000-0000000006c6',
  '33333333-0000-4000-a000-0000000006c7','33333333-0000-4000-a000-0000000006c8','33333333-0000-4000-a000-0000000006c9']::uuid[]) o;
INSERT INTO werkbank.order_technicians (org_id, order_id, artist_id) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006c1','33333333-0000-4000-a000-0000000006ca','99999999-0000-4000-9000-0000000006c2'),
  ('bbbbbbbb-0000-4000-b000-0000000006c2','33333333-0000-4000-a000-0000000006cb','99999999-0000-4000-9000-0000000006c3');
INSERT INTO werkbank.document_items (org_id, order_id, sort_order, kind, name, description, quantity, unit_code, labour_price, material_price, vat_rate) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006c1','33333333-0000-4000-a000-0000000006c9',1,'item','Therme tauschen','Inkl. Entsorgung',2,'H87',100,50,19),
  ('bbbbbbbb-0000-4000-b000-0000000006c1','33333333-0000-4000-a000-0000000006c9',0,'title','Heizung',NULL,NULL,NULL,NULL,NULL,NULL);
SET session_replication_role = DEFAULT;

INSERT INTO storage.buckets (id, name, public) VALUES ('other-bucket-vl','other-bucket-vl',false);
INSERT INTO storage.objects (bucket_id, name) VALUES ('other-bucket-vl','logos/readme.txt');

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

-- Bucket -------------------------------------------------------------------------------------
SELECT results_eq(
  $$SELECT public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'werkbank-visits'$$,
  $$VALUES (false, 5242880::bigint, ARRAY['image/jpeg','image/png']::text[])$$,
  'werkbank-visits is private, 5 MB, jpeg and png only');

-- Function grants ----------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege('anon', f, 'EXECUTE') AND has_function_privilege('authenticated', f, 'EXECUTE'),
  f || ' is executable by authenticated only')
FROM unnest(ARRAY[
  'werkbank.my_technician_orgs()',
  'werkbank.my_assignments(uuid, date)',
  'werkbank.my_assignment(uuid)',
  'werkbank.start_assignment(uuid)',
  'werkbank.complete_assignment(uuid)',
  'werkbank.create_visit_report(uuid, date)',
  'werkbank.update_visit_report(uuid, text, date)',
  'werkbank.add_visit_photo(uuid, text, text)',
  'werkbank.remove_visit_photo(uuid)',
  'werkbank.lock_visit_report(uuid)',
  'werkbank.sign_visit_report(uuid, text, text)',
  'werkbank.can_read_visit_object(text)',
  'werkbank.can_write_visit_object(text)',
  'werkbank.can_delete_visit_object(text)',
  'werkbank.visit_folder_has_room(text)']) f;
SELECT ok(NOT has_function_privilege('anon', 'werkbank.assigned_artist(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'werkbank.assigned_artist(uuid)', 'EXECUTE'),
  'werkbank.assigned_artist is private');
SELECT ok(
  (SELECT bool_and(p.prosecdef) FROM pg_proc p WHERE p.pronamespace = 'werkbank'::regnamespace AND p.proname IN (
    'my_technician_orgs','my_assignments','my_assignment','start_assignment','complete_assignment','create_visit_report',
    'update_visit_report','add_visit_photo','remove_visit_photo','lock_visit_report','sign_visit_report',
    'can_read_visit_object','can_write_visit_object','can_delete_visit_object','visit_folder_has_room','assigned_artist')),
  'every technician RPC and helper is security definer');

-- my_technician_orgs -------------------------------------------------------------------------
-- A is also a linked artist member of a production org, which is not a technician org.
SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006c3','VL Prod','vl-prod','production');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006c3','aaaaaaaa-0000-4000-a000-0000000006c3','artist');
INSERT INTO public.artists (id, org_id, user_id, name) VALUES
  ('99999999-0000-4000-9000-0000000006c4','bbbbbbbb-0000-4000-b000-0000000006c3','aaaaaaaa-0000-4000-a000-0000000006c3','Tina Technik');
SET session_replication_role = DEFAULT;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT results_eq($$SELECT * FROM werkbank.my_technician_orgs()$$,
  $$VALUES ('bbbbbbbb-0000-4000-b000-0000000006c1'::uuid)$$,
  'my_technician_orgs: the handwerk org of technician A, not the production org with an artist row');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c2');
SET LOCAL ROLE authenticated;
SELECT is_empty($$SELECT * FROM werkbank.my_technician_orgs()$$, 'my_technician_orgs: nothing for a producer without a technician row');
SELECT is_empty($$SELECT * FROM werkbank.my_assignments('bbbbbbbb-0000-4000-b000-0000000006c1')$$,
  'my_assignments: nothing for a producer without a technician row');
RESET ROLE;

-- my_assignments -----------------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT results_eq(
  $$SELECT order_no, group_key FROM werkbank.my_assignments('bbbbbbbb-0000-4000-b000-0000000006c1') ORDER BY order_no$$,
  $$VALUES ('AU-1','overdue'), ('AU-2','today'), ('AU-3','upcoming'), ('AU-5','unscheduled'), ('AU-6','done'), ('AU-9','upcoming')$$,
  'my_assignments: only assigned orders, grouped; 8 days ahead, done 20 days ago and cancelled are absent');
SELECT results_eq(
  $$SELECT group_key FROM werkbank.my_assignments('bbbbbbbb-0000-4000-b000-0000000006c1', current_setting('wbt.today')::date + 1) WHERE order_no = 'AU-2'$$,
  $$VALUES ('overdue')$$, 'my_assignments: an order of today is overdue the next Berlin day');
SELECT results_eq(
  $$SELECT id, status, scheduled_date, scheduled_time, subject, customer_name, street, postal_code, city
    FROM werkbank.my_assignments('bbbbbbbb-0000-4000-b000-0000000006c1') WHERE order_no = 'AU-9'$$,
  $$VALUES ('33333333-0000-4000-a000-0000000006c9'::uuid, 'open', current_setting('wbt.today')::date + 3, '10:30'::time,
    'Heizung', 'Eins', 'Hausweg 5', '01069', 'Dresden')$$,
  'my_assignments: list fields with the property address');
SELECT results_eq(
  $$SELECT street FROM werkbank.my_assignments('bbbbbbbb-0000-4000-b000-0000000006c1') WHERE order_no = 'AU-1'$$,
  $$VALUES ('Kundenweg 1')$$, 'my_assignments: the customer address without a property');
SELECT is_empty($$SELECT * FROM werkbank.my_assignments('bbbbbbbb-0000-4000-b000-0000000006c2')$$,
  'my_assignments: nothing in another org');

-- my_assignment ------------------------------------------------------------------------------
SELECT is((werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9')) -> 'order' ->> 'order_no', 'AU-9',
  'my_assignment: the order');
SELECT is((werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9')) -> 'order' ->> 'location_note', 'Schlüssel beim Nachbarn',
  'my_assignment: the location note');
SELECT is((werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9')) -> 'order' ->> 'group_key', 'upcoming',
  'my_assignment: the group key');
SELECT is_empty(
  $$SELECT k FROM jsonb_object_keys(werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9') -> 'order') k
    WHERE k ~ '(price|discount|total|^vat)'$$,
  'my_assignment: no price, discount or total in the order');
SELECT is((werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9')) -> 'contact',
  '{"name":"Karl Kontakt","phone":"0351 1","mobile":"0170 1","email":"karl@example.com"}'::jsonb, 'my_assignment: the contact');
SELECT is((werkbank.my_assignment('33333333-0000-4000-a000-0000000006c1')) -> 'contact', 'null'::jsonb,
  'my_assignment: contact is null without one');
SELECT is(jsonb_array_length(werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9') -> 'items'), 2,
  'my_assignment: every line item');
SELECT is((werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9')) -> 'items' -> 1,
  '{"position":1,"title":"Therme tauschen","description":"Inkl. Entsorgung","quantity":2.000,"unit":"H87","kind":"item"}'::jsonb,
  'my_assignment: an item has position, title, description, quantity, unit and kind');
SELECT is_empty(
  $$SELECT k FROM jsonb_object_keys(werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9') -> 'items' -> 1) k
    WHERE k ~ '(price|discount|total|^vat)'$$,
  'my_assignment: no price, discount, total or vat key on an item');
SELECT is((werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9')) -> 'technicians', '["Tina Technik"]'::jsonb,
  'my_assignment: the technician names');
SELECT is((werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9')) -> 'reports', '[]'::jsonb,
  'my_assignment: no reports yet');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c4');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9')$$,
  '42501', 'not_assigned', 'my_assignment: an unassigned technician of the org gets not_assigned');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c5');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9')$$,
  '42501', 'not_assigned', 'my_assignment: a technician of another org gets not_assigned');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT werkbank.my_assignment(gen_random_uuid())$$,
  '42501', 'not_assigned', 'my_assignment: an unknown order gets not_assigned');

-- Status ---------------------------------------------------------------------------------------
SELECT throws_ok($$SELECT werkbank.complete_assignment('33333333-0000-4000-a000-0000000006c2')$$,
  '22023', 'invalid_transition', 'complete_assignment: an open order cannot be completed');
SELECT lives_ok($$SELECT werkbank.start_assignment('33333333-0000-4000-a000-0000000006c2')$$, 'start_assignment as A');
SELECT is((SELECT status FROM werkbank.my_assignments('bbbbbbbb-0000-4000-b000-0000000006c1') WHERE order_no = 'AU-2'),
  'in_progress', 'start_assignment: open -> in_progress');
SELECT throws_ok($$SELECT werkbank.start_assignment('33333333-0000-4000-a000-0000000006c2')$$,
  '22023', 'invalid_transition', 'start_assignment: a second start fails');
SELECT lives_ok($$SELECT werkbank.complete_assignment('33333333-0000-4000-a000-0000000006c2')$$, 'complete_assignment as A');
SELECT throws_ok($$SELECT werkbank.complete_assignment('33333333-0000-4000-a000-0000000006c2')$$,
  '22023', 'invalid_transition', 'complete_assignment: a second completion fails');
SELECT throws_ok($$SELECT werkbank.start_assignment('33333333-0000-4000-a000-0000000006c8')$$,
  '22023', 'invalid_transition', 'start_assignment: a cancelled order cannot start');
RESET ROLE;
SELECT results_eq(
  $$SELECT status, completed_by FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000006c2'$$,
  $$VALUES ('done', 'aaaaaaaa-0000-4000-a000-0000000006c3'::uuid)$$,
  'complete_assignment: done, completed_by is the technician');
SELECT results_eq(
  $$SELECT user_id, org_id, title, message, related_entity_type, read FROM public.notifications
    WHERE type = 'werkbank_order_completed' AND related_entity_id = '33333333-0000-4000-a000-0000000006c2' ORDER BY user_id$$,
  $$VALUES
    ('aaaaaaaa-0000-4000-a000-0000000006c1'::uuid, 'bbbbbbbb-0000-4000-b000-0000000006c1'::uuid, 'Auftrag erledigt',
     'Tina Technik hat Auftrag AU-2 als erledigt gemeldet.', 'werkbank_order', false),
    ('aaaaaaaa-0000-4000-a000-0000000006c2'::uuid, 'bbbbbbbb-0000-4000-b000-0000000006c1'::uuid, 'Auftrag erledigt',
     'Tina Technik hat Auftrag AU-2 als erledigt gemeldet.', 'werkbank_order', false)$$,
  'complete_assignment: one notification each for admin and producer, none for the technician');

-- An admin who is also the assigned technician gets no notification of their own completion.
SET session_replication_role = replica;
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006c1','aaaaaaaa-0000-4000-a000-0000000006c3','admin');
UPDATE werkbank.orders SET status = 'in_progress' WHERE id = '33333333-0000-4000-a000-0000000006c1';
SET session_replication_role = DEFAULT;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT werkbank.complete_assignment('33333333-0000-4000-a000-0000000006c1')$$, 'complete_assignment as an admin technician');
RESET ROLE;
SELECT results_eq(
  $$SELECT user_id FROM public.notifications
    WHERE type = 'werkbank_order_completed' AND related_entity_id = '33333333-0000-4000-a000-0000000006c1' ORDER BY user_id$$,
  $$VALUES ('aaaaaaaa-0000-4000-a000-0000000006c1'::uuid), ('aaaaaaaa-0000-4000-a000-0000000006c2'::uuid)$$,
  'complete_assignment: the caller is never notified, even as an admin');
DELETE FROM public.org_memberships WHERE user_id = 'aaaaaaaa-0000-4000-a000-0000000006c3' AND role = 'admin';

-- Reports ---------------------------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT set_config('wbt.r1', werkbank.create_visit_report('33333333-0000-4000-a000-0000000006c9')::text, true)$$,
  'create_visit_report as A (r1)');
SELECT lives_ok($$SELECT set_config('wbt.r3', werkbank.create_visit_report('33333333-0000-4000-a000-0000000006c9', current_setting('wbt.today')::date - 1)::text, true)$$,
  'create_visit_report with a visit date (r3)');
SELECT lives_ok($$SELECT set_config('wbt.r4', werkbank.create_visit_report('33333333-0000-4000-a000-0000000006c9')::text, true)$$,
  'create_visit_report (r4)');
SELECT throws_ok($$SELECT werkbank.create_visit_report('33333333-0000-4000-a000-0000000006c8')$$,
  '55000', 'order_closed', 'create_visit_report: no report on a cancelled order');
SELECT throws_ok($$SELECT werkbank.create_visit_report('33333333-0000-4000-a000-0000000006ca')$$,
  '42501', 'not_assigned', 'create_visit_report: not on an order of another technician');
RESET ROLE;
SELECT results_eq(
  $$SELECT org_id, artist_id, technician_name, visit_date, body, locked_at FROM werkbank.visit_reports WHERE id = current_setting('wbt.r1')::uuid$$,
  $$VALUES ('bbbbbbbb-0000-4000-b000-0000000006c1'::uuid, '99999999-0000-4000-9000-0000000006c1'::uuid, 'Tina Technik',
    current_setting('wbt.today')::date, '', NULL::timestamptz)$$,
  'create_visit_report: author, name, Berlin date, empty and unlocked');
SELECT is((SELECT visit_date FROM werkbank.visit_reports WHERE id = current_setting('wbt.r3')::uuid),
  current_setting('wbt.today')::date - 1, 'create_visit_report: the given visit date');

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT werkbank.update_visit_report(current_setting('wbt.r1')::uuid, 'Therme getauscht', current_setting('wbt.today')::date - 2)$$,
  'update_visit_report as the author');
SELECT throws_ok($$SELECT werkbank.update_visit_report(current_setting('wbt.r1')::uuid, repeat('x', 10001), current_date)$$,
  '22023', 'body_too_long', 'update_visit_report: a text over 10000 characters is refused');
RESET ROLE;
SELECT results_eq(
  $$SELECT body, visit_date FROM werkbank.visit_reports WHERE id = current_setting('wbt.r1')::uuid$$,
  $$VALUES ('Therme getauscht', current_setting('wbt.today')::date - 2)$$, 'update_visit_report: body and visit date');

-- Objects in the bucket (owner context, as uploaded through the Storage API).
INSERT INTO storage.objects (bucket_id, name)
SELECT 'werkbank-visits', 'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r1') || '/p' || n || '.jpg'
FROM generate_series(1, 21) n;
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('werkbank-visits', 'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/eeeeeeee-0000-4000-a000-000000000004.jpg'),
  ('werkbank-visits', 'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r3') || '/signature.png');

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT set_config('wbt.p1', werkbank.add_visit_photo(current_setting('wbt.r1')::uuid,
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r1') || '/p1.jpg', 'Vorher')::text, true)$$,
  'add_visit_photo registers an uploaded object');
SELECT throws_ok($$SELECT werkbank.add_visit_photo(current_setting('wbt.r1')::uuid,
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r1') || '/nope.jpg')$$,
  '22023', 'photo_missing', 'add_visit_photo: an unknown path is photo_missing');
SELECT throws_ok($$SELECT werkbank.add_visit_photo(current_setting('wbt.r1')::uuid,
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/eeeeeeee-0000-4000-a000-000000000004.jpg')$$,
  '22023', 'photo_missing', 'add_visit_photo: the path of another report is photo_missing');
SELECT throws_ok($$SELECT werkbank.add_visit_photo(current_setting('wbt.r3')::uuid,
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r3') || '/signature.png')$$,
  '22023', 'photo_missing', 'add_visit_photo: the signature is not a photo');
SELECT is(werkbank.remove_visit_photo(current_setting('wbt.p1')::uuid),
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r1') || '/p1.jpg',
  'remove_visit_photo returns the removed path');
SELECT lives_ok($$SELECT werkbank.add_visit_photo(current_setting('wbt.r1')::uuid,
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r1') || '/p' || n || '.jpg')
  FROM generate_series(1, 20) n$$, 'add_visit_photo: 20 photos');
SELECT throws_ok($$SELECT werkbank.add_visit_photo(current_setting('wbt.r1')::uuid,
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r1') || '/p21.jpg')$$,
  '22023', 'photo_limit', 'add_visit_photo: photo 21 is photo_limit');
RESET ROLE;
SELECT results_eq(
  $$SELECT count(*)::int, min(position), max(position) FROM werkbank.visit_report_photos WHERE report_id = current_setting('wbt.r1')::uuid$$,
  $$VALUES (20, 0, 19)$$, 'add_visit_photo: 20 rows in position order');

-- B is assigned to the same order and writes a report of their own.
INSERT INTO werkbank.order_technicians (org_id, order_id, artist_id) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000006c1','33333333-0000-4000-a000-0000000006c9','99999999-0000-4000-9000-0000000006c2');
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c4');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT set_config('wbt.r2', werkbank.create_visit_report('33333333-0000-4000-a000-0000000006c9')::text, true)$$,
  'create_visit_report as B (r2)');
SELECT throws_ok($$SELECT werkbank.update_visit_report(current_setting('wbt.r1')::uuid, 'fremd', current_setting('wbt.today')::date)$$,
  '42501', 'not_author', 'update_visit_report: B cannot change A''s report');
SELECT throws_ok($$SELECT werkbank.lock_visit_report(current_setting('wbt.r1')::uuid)$$,
  '42501', 'not_author', 'lock_visit_report: B cannot lock A''s report');
SELECT is(jsonb_array_length(werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9') -> 'reports'), 4,
  'my_assignment: B reads every report of the order');
SELECT is((SELECT count(*)::int FROM jsonb_array_elements(werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9') -> 'reports') r
  WHERE (r ->> 'is_mine')::boolean), 1, 'my_assignment: is_mine marks B''s own report');
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT werkbank.remove_visit_photo(p.id) FROM (SELECT gen_random_uuid() AS id) p$$,
  '42501', 'not_assigned', 'remove_visit_photo: an unknown photo is not_assigned');
SELECT throws_ok($$SELECT werkbank.update_visit_report(current_setting('wbt.r2')::uuid, 'fremd', current_setting('wbt.today')::date)$$,
  '42501', 'not_author', 'update_visit_report: A cannot change B''s report');
SELECT throws_ok($$SELECT werkbank.add_visit_photo(current_setting('wbt.r2')::uuid, 'x')$$,
  '42501', 'not_author', 'add_visit_photo: A cannot add to B''s report');
SELECT throws_ok($$SELECT werkbank.sign_visit_report(current_setting('wbt.r2')::uuid, 'Kunde', 'x')$$,
  '42501', 'not_author', 'sign_visit_report: A cannot sign B''s report');
SELECT ok(NOT (werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9') -> 'reports' -> 0 ? 'office_note'),
  'my_assignment: a report has no office_note');
SELECT is((werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9') -> 'reports' -> 0) - 'id' - 'photos' - 'visit_date',
  jsonb_build_object('artist_id', '99999999-0000-4000-9000-0000000006c1', 'technician_name', 'Tina Technik', 'body', 'Therme getauscht',
    'locked_at', NULL, 'signer_name', NULL, 'signature_path', NULL, 'signed_at', NULL, 'is_mine', true),
  'my_assignment: the oldest report first with its fields');
SELECT is(jsonb_array_length(werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9') -> 'reports' -> 0 -> 'photos'), 20,
  'my_assignment: the photos of a report');
SELECT is((werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9') -> 'reports' -> 0 -> 'photos' -> 0) - 'id' - 'path',
  '{"position":0,"caption":null}'::jsonb, 'my_assignment: a photo has position and caption');

-- Lock and sign.
SELECT lives_ok($$SELECT werkbank.lock_visit_report(current_setting('wbt.r1')::uuid)$$, 'lock_visit_report as the author');
SELECT throws_ok($$SELECT werkbank.update_visit_report(current_setting('wbt.r1')::uuid, 'neu', current_setting('wbt.today')::date)$$,
  '55000', 'report_locked', 'update_visit_report: a locked report cannot change');
SELECT throws_ok($$SELECT werkbank.lock_visit_report(current_setting('wbt.r1')::uuid)$$,
  '55000', 'report_locked', 'lock_visit_report: a second lock fails');
SELECT throws_ok($$SELECT werkbank.remove_visit_photo(
  (werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9') -> 'reports' -> 0 -> 'photos' -> 0 ->> 'id')::uuid)$$,
  '55000', 'report_locked', 'remove_visit_photo: not from a locked report');
SELECT throws_ok($$SELECT werkbank.sign_visit_report(current_setting('wbt.r3')::uuid, '   ',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r3') || '/signature.png')$$,
  '22023', 'signer_required', 'sign_visit_report: a blank name is signer_required');
SELECT throws_ok($$SELECT werkbank.sign_visit_report(current_setting('wbt.r3')::uuid, 'Kunde',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/signature.png')$$,
  '22023', 'photo_missing', 'sign_visit_report: the signature must be the report''s uploaded signature.png');
SELECT lives_ok($$SELECT werkbank.sign_visit_report(current_setting('wbt.r3')::uuid, '  Kunde Klar ',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r3') || '/signature.png')$$,
  'sign_visit_report as the author');
SELECT throws_ok($$SELECT werkbank.sign_visit_report(current_setting('wbt.r3')::uuid, 'Kunde Klar',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r3') || '/signature.png')$$,
  '55000', 'report_locked', 'sign_visit_report: a second signature fails');
RESET ROLE;
SELECT results_eq(
  $$SELECT signer_name, signature_path, signed_at IS NOT NULL, locked_at IS NOT NULL, signed_at = locked_at
    FROM werkbank.visit_reports WHERE id = current_setting('wbt.r3')::uuid$$,
  $$VALUES ('Kunde Klar', 'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r3') || '/signature.png',
    true, true, true)$$,
  'sign_visit_report: trimmed signer, path, signed_at and locked_at');

-- Storage policies ------------------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-visits',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/eeeeeeee-0000-4000-a000-000000000001.jpg')$$,
  'storage: A uploads under an own open report');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-visits',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r1') || '/x.jpg')$$,
  '42501', NULL, 'storage: A cannot upload under a locked report');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-visits',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r2') || '/x.jpg')$$,
  '42501', NULL, 'storage: A cannot upload under B''s report');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-visits',
  'bbbbbbbb-0000-4000-b000-0000000006c2/33333333-0000-4000-a000-0000000006cb/' || current_setting('wbt.r4') || '/x.jpg')$$,
  '42501', NULL, 'storage: A cannot upload under another org');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-visits',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c4/' || current_setting('wbt.r4') || '/x.jpg')$$,
  '42501', NULL, 'storage: A cannot upload under a report with the wrong order in the path');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-visits', 'bbbbbbbb-0000-4000-b000-0000000006c1/x.jpg')$$,
  '42501', NULL, 'storage: A cannot upload outside a report folder');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-visits', 'not-a-uuid/a/b/x.jpg')$$,
  '42501', NULL, 'storage: a malformed path is denied without a cast error');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'werkbank-visits'), 24,
  'storage: A reads every object of an assigned order');
SELECT lives_ok($$SELECT count(*) FROM storage.objects$$, 'storage: a select over a non-uuid path in another bucket does not error');
WITH u AS (UPDATE storage.objects SET name = name || '.bak' WHERE bucket_id = 'werkbank-visits' RETURNING 1)
SELECT is((SELECT count(*)::int FROM u), 0,
  'storage: no update policy');
SELECT lives_ok($$SELECT set_config('wbt.p4', werkbank.add_visit_photo(current_setting('wbt.r4')::uuid,
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/eeeeeeee-0000-4000-a000-000000000004.jpg')::text, true)$$,
  'add_visit_photo registers q1 on r4');
SELECT is(werkbank.add_visit_photo(current_setting('wbt.r4')::uuid,
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/eeeeeeee-0000-4000-a000-000000000004.jpg'),
  current_setting('wbt.p4')::uuid, 'add_visit_photo: registering the same path again returns the existing row');
SELECT set_config('storage.allow_delete_query', 'true', true);
WITH d AS (DELETE FROM storage.objects WHERE bucket_id = 'werkbank-visits' RETURNING name)
SELECT is((SELECT array_agg(name) FROM d),
  ARRAY['bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/eeeeeeee-0000-4000-a000-000000000001.jpg'],
  'storage: A deletes only the unregistered object under an own open report, not a registered photo');
SELECT is(werkbank.remove_visit_photo(current_setting('wbt.p4')::uuid),
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/eeeeeeee-0000-4000-a000-000000000004.jpg',
  'remove_visit_photo unregisters q1');
WITH d AS (DELETE FROM storage.objects WHERE bucket_id = 'werkbank-visits'
  AND name = 'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/eeeeeeee-0000-4000-a000-000000000004.jpg' RETURNING 1)
SELECT is((SELECT count(*)::int FROM d), 1, 'storage: A deletes the object after remove_visit_photo');
WITH d AS (DELETE FROM storage.objects WHERE bucket_id = 'werkbank-visits'
  AND name = 'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r3') || '/signature.png' RETURNING 1)
SELECT is((SELECT count(*)::int FROM d), 0, 'storage: A cannot delete the signature of a signed report');
SELECT set_config('storage.allow_delete_query', 'false', true);
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c2');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'werkbank-visits'), 22, 'storage: the producer reads the org''s objects');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-visits',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/y.jpg')$$,
  '42501', NULL, 'storage: the producer cannot upload');
SELECT set_config('storage.allow_delete_query', 'true', true);
WITH d AS (DELETE FROM storage.objects WHERE bucket_id = 'werkbank-visits' RETURNING 1)
SELECT is((SELECT count(*)::int FROM d), 0,
  'storage: the producer cannot delete');
SELECT set_config('storage.allow_delete_query', 'false', true);
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c5');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'werkbank-visits'), 0,
  'storage: a technician of another org reads nothing');
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c4');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-visits',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r2') || '/eeeeeeee-0000-4000-a000-000000000002.jpg')$$,
  'storage: B uploads under an own report');
RESET ROLE;

-- Names and closed orders -----------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-visits',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/notes.txt')$$,
  '42501', NULL, 'storage: only <uuid>.jpg and signature.png may be uploaded');
RESET ROLE;
SAVEPOINT full_folder;
INSERT INTO storage.objects (bucket_id, name)
SELECT 'werkbank-visits', 'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/' || gen_random_uuid() || '.jpg'
FROM generate_series(1, 30);
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-visits',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/eeeeeeee-0000-4000-a000-000000000005.jpg')$$,
  '42501', NULL, 'storage: a full report folder takes no more uploads');
SELECT set_config('storage.allow_delete_query', 'true', true);
WITH d AS (DELETE FROM storage.objects WHERE id = (SELECT id FROM storage.objects
  WHERE bucket_id = 'werkbank-visits' AND name LIKE '%/' || current_setting('wbt.r4') || '/%'
    AND name NOT IN (SELECT path FROM werkbank.visit_report_photos) LIMIT 1) RETURNING 1)
SELECT is((SELECT count(*)::int FROM d), 1, 'storage: the author can still delete an orphan in a full folder');
SELECT set_config('storage.allow_delete_query', 'false', true);
RESET ROLE;
ROLLBACK TO SAVEPOINT full_folder;
SAVEPOINT closed_order;
UPDATE werkbank.orders SET status = 'cancelled' WHERE id = '33333333-0000-4000-a000-0000000006c9';
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT werkbank.update_visit_report(current_setting('wbt.r4')::uuid, 'später', current_date)$$,
  '55000', 'order_closed', 'update_visit_report: a report of a cancelled order cannot change');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-visits',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/eeeeeeee-0000-4000-a000-000000000003.jpg')$$,
  '42501', NULL, 'storage: no upload under a report of a cancelled order');
RESET ROLE;
ROLLBACK TO SAVEPOINT closed_order;

-- Removed from the order ----------------------------------------------------------------------
DELETE FROM werkbank.order_technicians
WHERE order_id = '33333333-0000-4000-a000-0000000006c9' AND artist_id = '99999999-0000-4000-9000-0000000006c1';

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT is_empty($$SELECT 1 FROM werkbank.my_assignments('bbbbbbbb-0000-4000-b000-0000000006c1') WHERE order_no = 'AU-9'$$,
  'removed: the order leaves the list');
SELECT throws_ok($$SELECT werkbank.my_assignment('33333333-0000-4000-a000-0000000006c9')$$,
  '42501', 'not_assigned', 'removed: my_assignment');
SELECT throws_ok($$SELECT werkbank.start_assignment('33333333-0000-4000-a000-0000000006c9')$$,
  '42501', 'not_assigned', 'removed: start_assignment');
SELECT throws_ok($$SELECT werkbank.complete_assignment('33333333-0000-4000-a000-0000000006c9')$$,
  '42501', 'not_assigned', 'removed: complete_assignment');
SELECT throws_ok($$SELECT werkbank.create_visit_report('33333333-0000-4000-a000-0000000006c9')$$,
  '42501', 'not_assigned', 'removed: create_visit_report');
SELECT throws_ok($$SELECT werkbank.update_visit_report(current_setting('wbt.r4')::uuid, 'x', current_setting('wbt.today')::date)$$,
  '42501', 'not_assigned', 'removed: update_visit_report');
SELECT throws_ok($$SELECT werkbank.add_visit_photo(current_setting('wbt.r4')::uuid,
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/eeeeeeee-0000-4000-a000-000000000004.jpg')$$,
  '42501', 'not_assigned', 'removed: add_visit_photo');
RESET ROLE;
SELECT set_config('wbt.p2', (SELECT id FROM werkbank.visit_report_photos WHERE report_id = current_setting('wbt.r1')::uuid LIMIT 1)::text, true);
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT werkbank.remove_visit_photo(current_setting('wbt.p2')::uuid)$$,
  '42501', 'not_assigned', 'removed: remove_visit_photo');
SELECT throws_ok($$SELECT werkbank.lock_visit_report(current_setting('wbt.r4')::uuid)$$,
  '42501', 'not_assigned', 'removed: lock_visit_report');
SELECT throws_ok($$SELECT werkbank.sign_visit_report(current_setting('wbt.r4')::uuid, 'Kunde', 'x')$$,
  '42501', 'not_assigned', 'removed: sign_visit_report');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'werkbank-visits'), 0,
  'removed: storage objects of the order are no longer readable');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-visits',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c9/' || current_setting('wbt.r4') || '/z.jpg')$$,
  '42501', NULL, 'removed: no upload under the former report');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM werkbank.visit_reports WHERE artist_id = '99999999-0000-4000-9000-0000000006c1'), 3,
  'removed: the technician''s reports stay');

-- Removed from the org --------------------------------------------------------------------------
-- remove_org_member deletes the membership and keeps the artist row linked; A is still assigned to
-- AU-3 and has an open report there with an object.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT set_config('wbt.r5', werkbank.create_visit_report('33333333-0000-4000-a000-0000000006c3')::text, true)$$,
  'create_visit_report on AU-3 (r5)');
RESET ROLE;
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('werkbank-visits', 'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c3/' || current_setting('wbt.r5') || '/m1.jpg');
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'werkbank-visits'), 1, 'member: A reads the object of AU-3');
RESET ROLE;
DELETE FROM public.org_memberships
WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000006c1' AND user_id = 'aaaaaaaa-0000-4000-a000-0000000006c3';
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000006c3');
SET LOCAL ROLE authenticated;
SELECT is_empty($$SELECT * FROM werkbank.my_technician_orgs()$$, 'non-member: my_technician_orgs excludes the org');
SELECT is_empty($$SELECT * FROM werkbank.my_assignments('bbbbbbbb-0000-4000-b000-0000000006c1')$$,
  'non-member: my_assignments returns nothing');
SELECT throws_ok($$SELECT werkbank.my_assignment('33333333-0000-4000-a000-0000000006c3')$$,
  '42501', 'not_assigned', 'non-member: my_assignment');
SELECT throws_ok($$SELECT werkbank.start_assignment('33333333-0000-4000-a000-0000000006c3')$$,
  '42501', 'not_assigned', 'non-member: start_assignment');
SELECT throws_ok($$SELECT werkbank.update_visit_report(current_setting('wbt.r5')::uuid, 'x', current_setting('wbt.today')::date)$$,
  '42501', 'not_assigned', 'non-member: update_visit_report');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'werkbank-visits'), 0, 'non-member: storage select denied');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-visits',
  'bbbbbbbb-0000-4000-b000-0000000006c1/33333333-0000-4000-a000-0000000006c3/' || current_setting('wbt.r5') || '/m2.jpg')$$,
  '42501', NULL, 'non-member: storage insert denied');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
