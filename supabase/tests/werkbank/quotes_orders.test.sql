-- Werkbank Teil 3: quotes, orders, order_technicians, document_items, company_profiles, quote_acceptances.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(47);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000f1','authenticated','authenticated','qo-admin-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000f2','authenticated','authenticated','qo-producer-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000f3','authenticated','authenticated','qo-tech-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000f4','authenticated','authenticated','qo-admin-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','QO Org A','qo-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000f2','QO Org B','qo-org-b','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','aaaaaaaa-0000-4000-a000-0000000000f1','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000000f1','aaaaaaaa-0000-4000-a000-0000000000f2','producer'),
  ('bbbbbbbb-0000-4000-b000-0000000000f1','aaaaaaaa-0000-4000-a000-0000000000f3','artist'),
  ('bbbbbbbb-0000-4000-b000-0000000000f2','aaaaaaaa-0000-4000-a000-0000000000f4','admin');
INSERT INTO public.artists (id, org_id, name) VALUES
  ('99999999-0000-4000-9000-0000000000a1','bbbbbbbb-0000-4000-b000-0000000000f1','Tech A'),
  ('99999999-0000-4000-9000-0000000000b1','bbbbbbbb-0000-4000-b000-0000000000f2','Tech B');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, last_name, street, postal_code, city) VALUES
  ('cccccccc-0000-4000-c000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','K-1','private','Eins','Weg 1','01067','Dresden'),
  ('cccccccc-0000-4000-c000-0000000000f2','bbbbbbbb-0000-4000-b000-0000000000f1','K-2','private','Zwei','Weg 2','01067','Dresden');
INSERT INTO werkbank.properties (id, org_id, customer_id, name, street, postal_code, city) VALUES
  ('dddddddd-0000-4000-d000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f1','Objekt 1','Weg 1','01067','Dresden'),
  ('dddddddd-0000-4000-d000-0000000000f2','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f2','Objekt 2','Weg 2','01067','Dresden');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.del_count(_tbl text, _where text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE format('WITH d AS (DELETE FROM %s WHERE %s RETURNING 1) SELECT count(*)::int FROM d', _tbl, _where) INTO n;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.del_count(text, text) TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.row_count(_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE _sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.row_count(text) TO PUBLIC;

-- Tables exist and RLS is on.
SELECT has_table('werkbank', 'company_profiles', 'company_profiles exists');
SELECT has_table('werkbank', 'quotes', 'quotes exists');
SELECT has_table('werkbank', 'orders', 'orders exists');
SELECT has_table('werkbank', 'order_technicians', 'order_technicians exists');
SELECT has_table('werkbank', 'document_items', 'document_items exists');
SELECT has_table('werkbank', 'quote_acceptances', 'quote_acceptances exists');
SELECT is(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'werkbank'
      AND c.relname IN ('company_profiles','quotes','orders','order_technicians','document_items','quote_acceptances')
      AND c.relrowsecurity),
  6, 'RLS is enabled on all six tables');

-- Producer A: writes quotes, orders, items.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f2');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO werkbank.quotes (id, org_id, customer_id, property_id, valid_until)
  VALUES ('11111111-0000-4000-a000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f1','dddddddd-0000-4000-d000-0000000000f1', current_date + 30)$$,
  'producer A inserts a quote');
SELECT lives_ok($$INSERT INTO werkbank.quotes (id, org_id, customer_id, valid_until)
  VALUES ('11111111-0000-4000-a000-0000000000f2','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f1', current_date + 30)$$,
  'producer A inserts a second quote');
SELECT lives_ok($$INSERT INTO werkbank.document_items (id, org_id, quote_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate)
  VALUES ('22222222-0000-4000-a000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f1',1,'item','Rohr',2.5,'HUR',10.10,3.333,19)$$,
  'producer A inserts an item');
SELECT is((SELECT line_net FROM werkbank.document_items WHERE id = '22222222-0000-4000-a000-0000000000f1'),
  33.58::numeric, 'line_net of 2.5 x (10.10 + 3.33) is 33.58');
SELECT lives_ok($$INSERT INTO werkbank.document_items (org_id, quote_id, sort_order, kind, name)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f1',0,'title','Bad')$$,
  'a title row with a name is allowed');
SELECT lives_ok($$INSERT INTO werkbank.document_items (org_id, quote_id, sort_order, kind, description)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f1',2,'text','Hinweis')$$,
  'a text row with a description is allowed');
SELECT lives_ok($$INSERT INTO werkbank.orders (id, org_id, customer_id)
  VALUES ('33333333-0000-4000-a000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f1')$$,
  'producer A inserts an order');
SELECT lives_ok($$INSERT INTO werkbank.document_items (id, org_id, order_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate)
  VALUES ('22222222-0000-4000-a000-0000000000f9','bbbbbbbb-0000-4000-b000-0000000000f1','33333333-0000-4000-a000-0000000000f1',1,'item','Rohr',1,'H87',0,5,7)$$,
  'producer A inserts an order item');
-- source_item_id is provenance set by create_order_from_quote (owner context), not by users.
RESET ROLE;
UPDATE werkbank.document_items SET source_item_id = '22222222-0000-4000-a000-0000000000f1'
  WHERE id = '22222222-0000-4000-a000-0000000000f9';
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f2');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO werkbank.order_technicians (org_id, order_id, artist_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','33333333-0000-4000-a000-0000000000f1','99999999-0000-4000-9000-0000000000a1')$$,
  'producer A assigns a technician of the same org');
SELECT is((SELECT count(*)::int FROM werkbank.quotes), 2, 'producer A reads the quotes');
SELECT is((SELECT count(*)::int FROM werkbank.orders), 1, 'producer A reads the order');
SELECT is((SELECT count(*)::int FROM werkbank.document_items), 4, 'producer A reads the items');
SELECT is((SELECT count(*)::int FROM werkbank.order_technicians), 1, 'producer A reads the technicians');

-- Technician A (artist role) and admin B see nothing while rows exist in every table.
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f3');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.quotes) + (SELECT count(*)::int FROM werkbank.orders)
  + (SELECT count(*)::int FROM werkbank.document_items) + (SELECT count(*)::int FROM werkbank.company_profiles)
  + (SELECT count(*)::int FROM werkbank.order_technicians)
  + (SELECT count(*)::int FROM werkbank.quote_acceptances), 0, 'technician A sees no rows');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f4');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.quotes) + (SELECT count(*)::int FROM werkbank.orders)
  + (SELECT count(*)::int FROM werkbank.document_items) + (SELECT count(*)::int FROM werkbank.company_profiles)
  + (SELECT count(*)::int FROM werkbank.order_technicians)
  + (SELECT count(*)::int FROM werkbank.quote_acceptances), 0, 'admin B sees no rows of org A');
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f2');
SET LOCAL ROLE authenticated;

-- Checks.
SELECT throws_ok($$INSERT INTO werkbank.document_items (org_id, quote_id, order_id, sort_order, kind, name)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f1','33333333-0000-4000-a000-0000000000f1',9,'title','X')$$,
  '23514', NULL, 'an item with both parents fails');
SELECT throws_ok($$INSERT INTO werkbank.document_items (org_id, sort_order, kind, name)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1',9,'title','X')$$,
  '23514', NULL, 'an item with no parent fails');
SELECT throws_ok($$INSERT INTO werkbank.document_items (org_id, quote_id, sort_order, kind, name, quantity, labour_price, material_price, vat_rate)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f1',9,'item','NoUnit',1,1,1,19)$$,
  '23514', NULL, 'an item row without unit fails');
SELECT throws_ok($$INSERT INTO werkbank.document_items (org_id, quote_id, sort_order, kind, name, unit_code, labour_price, material_price, vat_rate)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f1',9,'item','NoQty','H87',1,1,19)$$,
  '23514', NULL, 'an item row without quantity fails');
SELECT throws_ok($$INSERT INTO werkbank.document_items (org_id, quote_id, sort_order, kind, name, labour_price)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f1',9,'title','Priced',5)$$,
  '23514', NULL, 'a title row with a price fails');
SELECT throws_ok($$INSERT INTO werkbank.quotes (org_id, customer_id, property_id, valid_until)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f1','dddddddd-0000-4000-d000-0000000000f2', current_date)$$,
  '23514', 'property_customer_mismatch', 'a quote with a property of another customer fails');
SELECT throws_ok($$INSERT INTO werkbank.orders (org_id, customer_id, property_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f1','dddddddd-0000-4000-d000-0000000000f2')$$,
  '23514', 'property_customer_mismatch', 'an order with a property of another customer fails');
SELECT throws_ok($$INSERT INTO werkbank.order_technicians (org_id, order_id, artist_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','33333333-0000-4000-a000-0000000000f1','99999999-0000-4000-9000-0000000000b1')$$,
  '23514', 'artist_org_mismatch', 'a technician of another org fails');
-- The polish trigger clears a time without a date before the check runs (tested in
-- teil3_polish); the constraint stays as the backstop.
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_time_needs_date'
  AND conrelid = 'werkbank.orders'::regclass), 'the scheduled_time-needs-a-date check constraint exists');
SELECT throws_ok($$INSERT INTO werkbank.quotes (org_id, customer_id, valid_until, status)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f1', current_date, 'expired')$$,
  '23514', NULL, 'an unknown quote status fails');
-- Numbers are set by the trigger for users; the service side may set one (unique check).
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$INSERT INTO werkbank.quotes (org_id, quote_no, version, customer_id, valid_until)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','A-0001',1,'cccccccc-0000-4000-c000-0000000000f1', current_date)$$,
  '23505', NULL, 'quote_no and version are unique per org');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f2');
SET LOCAL ROLE authenticated;

-- Delete rules.
SELECT is(pg_temp.del_count('werkbank.document_items', $q$id = '22222222-0000-4000-a000-0000000000f1'$q$), 1,
  'producer A deletes an item that is referenced as source (set null)');
RESET ROLE;
UPDATE werkbank.quotes SET status = 'sent' WHERE id = '11111111-0000-4000-a000-0000000000f2';
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f2');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.del_count('werkbank.quotes', $q$id = '11111111-0000-4000-a000-0000000000f2'$q$), 0,
  'a sent quote cannot be deleted');
SELECT is(pg_temp.del_count('werkbank.quotes', $q$id = '11111111-0000-4000-a000-0000000000f1'$q$), 1,
  'a draft quote can be deleted (items cascade)');
SELECT is(pg_temp.del_count('werkbank.orders', $q$id = '33333333-0000-4000-a000-0000000000f1'$q$), 1,
  'an open order can be deleted');

-- company_profiles and quote_acceptances.
SELECT throws_ok($$INSERT INTO werkbank.company_profiles (org_id, company_name, street, postal_code, city)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','Firma','Weg 1','01067','Dresden')$$,
  '42501', NULL, 'producer A cannot insert a company profile');
RESET ROLE;
SET session_replication_role = replica;
INSERT INTO werkbank.company_profiles (org_id, company_name, street, postal_code, city)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','Firma','Weg 1','01067','Dresden');
SET session_replication_role = DEFAULT;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f2');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.company_profiles), 1, 'producer A reads the company profile');
SELECT is(pg_temp.row_count($q$UPDATE werkbank.company_profiles SET company_name = 'Neu'$q$),
  0, 'producer A cannot update the company profile');
SELECT throws_ok($$INSERT INTO werkbank.quote_acceptances (org_id, quote_id, decision, signer_name, document_sha256)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f2','accepted','X','abc')$$,
  '42501', NULL, 'authenticated cannot write quote_acceptances');
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f1');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.row_count($q$UPDATE werkbank.company_profiles SET company_name = 'Neu'$q$),
  1, 'admin A updates the company profile');
SELECT throws_ok($$UPDATE werkbank.company_profiles SET email = 'info@firma'$$,
  '23514', NULL, 'a company email without a dot in the domain fails');
SELECT is(pg_temp.row_count($q$UPDATE werkbank.company_profiles SET email = 'info@firma.de'$q$),
  1, 'a company email with a dotted domain is stored');
SELECT throws_ok($$INSERT INTO werkbank.company_profiles (org_id, company_name, street, postal_code, city)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f2','Fremd','Weg 1','01067','Dresden')$$,
  '42501', NULL, 'admin A cannot insert a company profile for org B');
RESET ROLE;

-- A quote acceptance written by the service side is readable by the producer.
INSERT INTO werkbank.quote_acceptances (org_id, quote_id, decision, signer_name, method, typed_name, document_sha256)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f2','accepted','Max','typed','Max','abc');
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f2');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.quote_acceptances), 1, 'producer A reads quote acceptances');
RESET ROLE;

-- Org delete cascades.
DELETE FROM public.artists WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000f1';
DELETE FROM public.organizations WHERE id = 'bbbbbbbb-0000-4000-b000-0000000000f1';
SELECT is((SELECT count(*)::int FROM werkbank.quotes WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000f1'), 0, 'org delete removes quotes');

SELECT * FROM finish();
ROLLBACK;
