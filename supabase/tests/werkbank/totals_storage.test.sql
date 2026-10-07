-- Werkbank Teil 3 (R3, R4): document totals and list views, storage buckets and policies.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(49);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000f1','authenticated','authenticated','ts-admin-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000f2','authenticated','authenticated','ts-producer-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000f3','authenticated','authenticated','ts-artist-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000f4','authenticated','authenticated','ts-admin-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','TS Org A','ts-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000f2','TS Org B','ts-org-b','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','aaaaaaaa-0000-4000-a000-0000000000f1','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000000f1','aaaaaaaa-0000-4000-a000-0000000000f2','producer'),
  ('bbbbbbbb-0000-4000-b000-0000000000f1','aaaaaaaa-0000-4000-a000-0000000000f3','artist'),
  ('bbbbbbbb-0000-4000-b000-0000000000f2','aaaaaaaa-0000-4000-a000-0000000000f4','admin');
INSERT INTO public.artists (id, org_id, name) VALUES
  ('99999999-0000-4000-9000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','Zora Tech'),
  ('99999999-0000-4000-9000-0000000000f2','bbbbbbbb-0000-4000-b000-0000000000f1','Anton Tech');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, last_name, first_name, company_name, street, postal_code, city) VALUES
  ('cccccccc-0000-4000-c000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','K-1','private','Eins','Erna',null,'Weg 1','01067','Dresden'),
  ('cccccccc-0000-4000-c000-0000000000f2','bbbbbbbb-0000-4000-b000-0000000000f1','K-2','property_manager',null,null,'Hausverwaltung Zwei','Weg 2','01067','Dresden');
INSERT INTO werkbank.properties (id, org_id, customer_id, name, street, postal_code, city) VALUES
  ('dddddddd-0000-4000-d000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f1','Objekt 1','Weg 1','01067','Dresden');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

-- Fixtures (as the table owner) -------------------------------------------------------
-- Q1: 19 % 3 x 0.335 (line_net 0.34 each) and 7 % 10.00, discount 3 %.
INSERT INTO werkbank.quotes (id, org_id, customer_id, property_id, subject, discount_percent, valid_until)
  VALUES ('11111111-0000-4000-a000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f1',
          'dddddddd-0000-4000-d000-0000000000f1','Rundum', 3, current_date + 30);
INSERT INTO werkbank.document_items (org_id, quote_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f1',1,'item','A',1,'H87',0,0.335,19),
  ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f1',2,'item','B',1,'H87',0,0.335,19),
  ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f1',3,'item','C',1,'H87',0,0.335,19),
  ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f1',4,'item','D',1,'H87',0,10.00,7);
-- Q2: same items, discount 100 %.
INSERT INTO werkbank.quotes (id, org_id, customer_id, discount_percent, valid_until)
  VALUES ('11111111-0000-4000-a000-0000000000f2','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f1', 100, current_date + 30);
INSERT INTO werkbank.document_items (org_id, quote_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f2',1,'item','A',1,'H87',0,0.335,19),
  ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f2',2,'item','D',1,'H87',0,10.00,7);
-- Q3: only a title row.
INSERT INTO werkbank.quotes (id, org_id, customer_id, valid_until)
  VALUES ('11111111-0000-4000-a000-0000000000f3','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f1', current_date + 30);
INSERT INTO werkbank.document_items (org_id, quote_id, sort_order, kind, name)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f3',1,'title','Nur ein Titel');
-- Q4: labour 60 + material 40 at quantity 1, discount 10 %.
INSERT INTO werkbank.quotes (id, org_id, customer_id, discount_percent, valid_until)
  VALUES ('11111111-0000-4000-a000-0000000000f4','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f1', 10, current_date + 30);
INSERT INTO werkbank.document_items (org_id, quote_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f4',1,'item','L',1,'H87',60,40,19);
-- Q5 sent yesterday (Berlin), Q6 draft yesterday, Q7 sent and valid until today, Q8 accepted with an order.
INSERT INTO werkbank.quotes (id, org_id, customer_id, valid_until) VALUES
  ('11111111-0000-4000-a000-0000000000f5','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f2', (now() at time zone 'Europe/Berlin')::date - 1),
  ('11111111-0000-4000-a000-0000000000f6','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f2', (now() at time zone 'Europe/Berlin')::date - 1),
  ('11111111-0000-4000-a000-0000000000f7','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f2', (now() at time zone 'Europe/Berlin')::date),
  ('11111111-0000-4000-a000-0000000000f8','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f2', current_date + 30);
UPDATE werkbank.quotes SET status = 'sent', sent_at = now() WHERE id in
  ('11111111-0000-4000-a000-0000000000f5','11111111-0000-4000-a000-0000000000f7','11111111-0000-4000-a000-0000000000f8');
UPDATE werkbank.quotes SET status = 'accepted' WHERE id = '11111111-0000-4000-a000-0000000000f8';
-- Order O1 from Q8 with two technicians and one 19 % item; O2 direct, without items.
INSERT INTO werkbank.orders (id, org_id, quote_id, customer_id, subject, discount_percent)
  VALUES ('33333333-0000-4000-a000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f8','cccccccc-0000-4000-c000-0000000000f2','Auftrag', 0);
INSERT INTO werkbank.orders (id, org_id, customer_id) VALUES
  ('33333333-0000-4000-a000-0000000000f2','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f2');
INSERT INTO werkbank.document_items (org_id, order_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','33333333-0000-4000-a000-0000000000f1',1,'item','O',2,'H87',50,0,19);
INSERT INTO werkbank.order_technicians (org_id, order_id, artist_id) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','33333333-0000-4000-a000-0000000000f1','99999999-0000-4000-9000-0000000000f1'),
  ('bbbbbbbb-0000-4000-b000-0000000000f1','33333333-0000-4000-a000-0000000000f1','99999999-0000-4000-9000-0000000000f2');

-- document_totals ---------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f2');
SET LOCAL ROLE authenticated;

SELECT ok((SELECT vat_breakdown FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f1')
  = '[{"rate":19,"net":1.02,"discounted_net":0.99,"vat":0.19},{"rate":7,"net":10.00,"discounted_net":9.70,"vat":0.68}]'::jsonb,
  'vat_breakdown per rate, rate descending, rounded per rate');
SELECT is((SELECT net_total FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f1'), 11.02::numeric, 'net_total');
SELECT is((SELECT discount_total FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f1'), 0.33::numeric, 'discount_total');
SELECT is((SELECT vat_total FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f1'), 0.87::numeric, 'vat_total');
SELECT is((SELECT gross_total FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f1'), 11.56::numeric, 'gross_total');
SELECT is((SELECT order_id FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f1'), null::uuid, 'a quote row has no order_id');

SELECT is((SELECT vat_total FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f2'), 0::numeric, '100 % discount: vat_total 0');
SELECT is((SELECT gross_total FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f2'), 0::numeric, '100 % discount: gross_total 0');
SELECT is((SELECT labour_total FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f2'), 0::numeric, '100 % discount: labour_total 0');
SELECT is((SELECT discount_total FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f2'),
          (SELECT net_total FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f2'), '100 % discount: discount_total equals net_total');
SELECT ok((SELECT bool_and((e->>'discounted_net')::numeric = 0 and (e->>'vat')::numeric = 0)
           FROM werkbank.document_totals t, jsonb_array_elements(t.vat_breakdown) e WHERE t.quote_id = '11111111-0000-4000-a000-0000000000f2'),
  '100 % discount: discounted_net and vat 0 per rate');

SELECT is((SELECT count(*)::int FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f3'), 1, 'a quote with only a title appears once');
SELECT ok((SELECT net_total = 0 and discount_total = 0 and vat_total = 0 and gross_total = 0 and labour_total = 0
           FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f3'), 'title only: all totals 0');
SELECT is((SELECT vat_breakdown FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f3'), '[]'::jsonb, 'title only: empty breakdown');

SELECT is((SELECT labour_total FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f4'), 54.00::numeric, 'labour 60 + material 40 at 10 %: labour_total 54.00');
SELECT is((SELECT gross_total FROM werkbank.document_totals WHERE quote_id = '11111111-0000-4000-a000-0000000000f4'), 107.10::numeric, 'same quote: gross 90 + 19 % = 107.10');

SELECT is((SELECT gross_total FROM werkbank.document_totals WHERE order_id = '33333333-0000-4000-a000-0000000000f1'), 119.00::numeric, 'order totals: 100 + 19 %');
SELECT is((SELECT quote_id FROM werkbank.document_totals WHERE order_id = '33333333-0000-4000-a000-0000000000f1'), null::uuid, 'an order row has no quote_id');
SELECT is((SELECT gross_total FROM werkbank.document_totals WHERE order_id = '33333333-0000-4000-a000-0000000000f2'), 0::numeric, 'an order without items appears with zeros');

-- quote_list --------------------------------------------------------------------------
SELECT is((SELECT is_expired FROM werkbank.quote_list WHERE id = '11111111-0000-4000-a000-0000000000f5'), true, 'sent with valid_until yesterday is expired');
SELECT is((SELECT is_expired FROM werkbank.quote_list WHERE id = '11111111-0000-4000-a000-0000000000f6'), false, 'draft with valid_until yesterday is not expired');
SELECT is((SELECT is_expired FROM werkbank.quote_list WHERE id = '11111111-0000-4000-a000-0000000000f7'), false, 'sent and valid until today is not expired');
SELECT is((SELECT has_order FROM werkbank.quote_list WHERE id = '11111111-0000-4000-a000-0000000000f8'), true, 'has_order true for a quote with an order');
SELECT is((SELECT has_order FROM werkbank.quote_list WHERE id = '11111111-0000-4000-a000-0000000000f1'), false, 'has_order false otherwise');
SELECT is((SELECT customer_name FROM werkbank.quote_list WHERE id = '11111111-0000-4000-a000-0000000000f1'), 'Erna Eins', 'customer_name of a private customer');
SELECT is((SELECT customer_name FROM werkbank.quote_list WHERE id = '11111111-0000-4000-a000-0000000000f5'), 'Hausverwaltung Zwei', 'customer_name of a property manager');
SELECT is((SELECT property_name FROM werkbank.quote_list WHERE id = '11111111-0000-4000-a000-0000000000f1'), 'Objekt 1', 'property_name');
SELECT is((SELECT gross_total FROM werkbank.quote_list WHERE id = '11111111-0000-4000-a000-0000000000f1'), 11.56::numeric, 'quote_list carries the totals');
SELECT is((SELECT quote_no FROM werkbank.quote_list WHERE id = '11111111-0000-4000-a000-0000000000f1'), 'A-0001', 'quote_list carries quote columns');

-- order_list --------------------------------------------------------------------------
SELECT is((SELECT technician_names FROM werkbank.order_list WHERE id = '33333333-0000-4000-a000-0000000000f1'), ARRAY['Anton Tech','Zora Tech'], 'technician_names sorted by name');
SELECT is((SELECT technician_ids FROM werkbank.order_list WHERE id = '33333333-0000-4000-a000-0000000000f1'),
  ARRAY['99999999-0000-4000-9000-0000000000f2','99999999-0000-4000-9000-0000000000f1']::uuid[], 'technician_ids in the same order');
SELECT is((SELECT technician_ids FROM werkbank.order_list WHERE id = '33333333-0000-4000-a000-0000000000f2'), '{}'::uuid[], 'no technicians: empty array');
SELECT is((SELECT gross_total FROM werkbank.order_list WHERE id = '33333333-0000-4000-a000-0000000000f1'), 119.00::numeric, 'order_list carries the totals');
SELECT is((SELECT customer_name FROM werkbank.order_list WHERE id = '33333333-0000-4000-a000-0000000000f2'), 'Hausverwaltung Zwei', 'order_list customer_name');

-- RLS applies through the views (security_invoker) ------------------------------------
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f4');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.quote_list), 0, 'admin of another org sees no quote_list rows');
SELECT is((SELECT count(*)::int FROM werkbank.document_totals), 0, 'admin of another org sees no totals');
RESET ROLE;
SELECT ok((SELECT bool_and(coalesce(c.reloptions, '{}') @> ARRAY['security_invoker=true'])
           FROM pg_class c WHERE c.relnamespace = 'werkbank'::regnamespace AND c.relname IN ('document_totals','quote_list','order_list')),
  'all three views are security_invoker');

-- Storage -----------------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-assets','bbbbbbbb-0000-4000-b000-0000000000f1/logo.png')$$,
  'admin of A inserts into werkbank-assets/A');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-assets','bbbbbbbb-0000-4000-b000-0000000000f2/logo.png')$$,
  '42501', null, 'admin of A cannot insert into werkbank-assets/B');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-documents','bbbbbbbb-0000-4000-b000-0000000000f1/x.pdf')$$,
  '42501', null, 'admin cannot insert into werkbank-documents');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-assets','logos/logo.png')$$,
  '42501', null, 'a non-uuid first segment is denied, not a 22P02 error');
RESET ROLE;
INSERT INTO storage.buckets (id, name) VALUES ('other-bucket-ts','other-bucket-ts');
INSERT INTO storage.objects (bucket_id, name) VALUES ('other-bucket-ts','logos/readme.txt'), ('werkbank-documents','logos/x.pdf');
INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-documents','bbbbbbbb-0000-4000-b000-0000000000f1/x.pdf');

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f2');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$SELECT count(*) FROM storage.objects$$, 'a select over objects with a non-uuid path in another bucket does not error');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'werkbank-documents' AND name = 'logos/x.pdf'), 0, 'non-uuid path in our bucket is invisible');
SELECT throws_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-assets','bbbbbbbb-0000-4000-b000-0000000000f1/logo2.png')$$,
  '42501', null, 'producer cannot insert into werkbank-assets');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'werkbank-documents' AND name = 'bbbbbbbb-0000-4000-b000-0000000000f1/x.pdf'), 1,
  'producer of A selects werkbank-documents/A/x.pdf');
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id = 'werkbank-assets' AND name = 'bbbbbbbb-0000-4000-b000-0000000000f1/logo.png'), 1,
  'producer of A selects werkbank-assets/A/logo.png');
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f4');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id IN ('werkbank-documents','werkbank-assets')), 0,
  'admin of B sees no objects of A');
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f3');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE bucket_id IN ('werkbank-documents','werkbank-assets')), 0,
  'an artist member of A sees no objects');
RESET ROLE;

SELECT is((SELECT count(*)::int FROM storage.buckets WHERE id IN ('werkbank-assets','werkbank-documents') AND NOT public), 2, 'both buckets are private');

SELECT * FROM finish();
ROLLBACK;
