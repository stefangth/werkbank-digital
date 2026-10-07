-- Werkbank Teil 4: invoices table, checks, RLS, document_items.invoice_id, orders status 'invoiced'.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(19);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000e2','authenticated','authenticated','inv-producer-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000e3','authenticated','authenticated','inv-tech-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000e4','authenticated','authenticated','inv-admin-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000e1','INV Org A','inv-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000e2','INV Org B','inv-org-b','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000e1','aaaaaaaa-0000-4000-a000-0000000000e2','producer'),
  ('bbbbbbbb-0000-4000-b000-0000000000e1','aaaaaaaa-0000-4000-a000-0000000000e3','artist'),
  ('bbbbbbbb-0000-4000-b000-0000000000e2','aaaaaaaa-0000-4000-a000-0000000000e4','admin');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, last_name, street, postal_code, city) VALUES
  ('cccccccc-0000-4000-c000-0000000000e1','bbbbbbbb-0000-4000-b000-0000000000e1','K-1','private','Eins','Weg 1','01067','Dresden'),
  ('cccccccc-0000-4000-c000-0000000000e2','bbbbbbbb-0000-4000-b000-0000000000e1','K-2','private','Zwei','Weg 2','01067','Dresden');
INSERT INTO werkbank.properties (id, org_id, customer_id, name, street, postal_code, city) VALUES
  ('dddddddd-0000-4000-d000-0000000000e2','bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e2','Objekt 2','Weg 2','01067','Dresden');
INSERT INTO werkbank.orders (id, org_id, order_no, customer_id) VALUES
  ('eeeeeeee-0000-4000-e000-0000000000e1','bbbbbbbb-0000-4000-b000-0000000000e1','A-1','cccccccc-0000-4000-c000-0000000000e1');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

SELECT has_table('werkbank', 'invoices', 'invoices exists');
SELECT ok((SELECT c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'werkbank' AND c.relname = 'invoices'), 'RLS is enabled on invoices');
SELECT has_index('werkbank', 'invoices', 'invoices_one_active_per_order', 'one-active-per-order index exists');

-- Producer A.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO werkbank.invoices (id, org_id, customer_id)
  VALUES ('66666666-0000-4000-a000-0000000000e1','bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1')$$,
  'producer A inserts a free invoice draft');
SELECT lives_ok($$INSERT INTO werkbank.document_items (org_id, invoice_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','66666666-0000-4000-a000-0000000000e1',1,'item','Rohr',1,'HUR',10,5,19)$$,
  'producer A inserts an item for the invoice');
SELECT is((SELECT count(*)::int FROM werkbank.invoices), 1, 'producer A reads the invoice');
SELECT is((SELECT count(*)::int FROM werkbank.document_items WHERE invoice_id = '66666666-0000-4000-a000-0000000000e1'), 1, 'producer A reads the item');

SELECT throws_ok($$INSERT INTO werkbank.document_items (org_id, invoice_id, order_id, sort_order, kind, name)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','66666666-0000-4000-a000-0000000000e1','eeeeeeee-0000-4000-e000-0000000000e1',2,'title','X')$$,
  '23514', NULL, 'an item with invoice_id and order_id is rejected');
SELECT throws_ok($$INSERT INTO werkbank.invoices (org_id, customer_id, type)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1','cancellation')$$,
  '23514', NULL, 'a cancellation without cancels_invoice_id is rejected');
SELECT throws_ok($$INSERT INTO werkbank.invoices (org_id, customer_id, cancels_invoice_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1','66666666-0000-4000-a000-0000000000e1')$$,
  '23514', NULL, 'an invoice with cancels_invoice_id is rejected');
SELECT throws_ok($$INSERT INTO werkbank.invoices (org_id, customer_id, status, seller_snapshot, buyer_snapshot)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1','issued','{}','{}')$$,
  '23514', NULL, 'issued without invoice_no is rejected');
SELECT throws_ok($$INSERT INTO werkbank.invoices (org_id, customer_id, service_date_from, service_date_to)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1','2026-10-05','2026-10-04')$$,
  '23514', NULL, 'service_date_to before service_date_from is rejected');
SELECT throws_ok($$INSERT INTO werkbank.invoices (org_id, customer_id, payment_due_days)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1',366)$$,
  '23514', NULL, 'payment_due_days 366 is rejected');
SELECT lives_ok($$INSERT INTO werkbank.invoices (org_id, customer_id, order_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1','eeeeeeee-0000-4000-e000-0000000000e1')$$,
  'first invoice draft for the order');
SELECT throws_ok($$INSERT INTO werkbank.invoices (org_id, customer_id, order_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1','eeeeeeee-0000-4000-e000-0000000000e1')$$,
  '23505', NULL, 'a second active invoice for the same order is rejected');
SELECT throws_ok($$INSERT INTO werkbank.invoices (org_id, customer_id, property_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1','dddddddd-0000-4000-d000-0000000000e2')$$,
  '23514', 'property_customer_mismatch', 'a property of another customer is rejected');

-- Technician A and admin B see nothing.
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e3');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.invoices), 0, 'technician of org A sees no invoices');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e4');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.invoices), 0, 'admin of org B sees no invoices');
RESET ROLE;

-- Owner: an order can hold the status 'invoiced' (triggers off; the transition rules come later).
SET session_replication_role = replica;
SELECT lives_ok($$UPDATE werkbank.orders SET status = 'invoiced' WHERE id = 'eeeeeeee-0000-4000-e000-0000000000e1'$$,
  'an order can hold status invoiced');

SELECT * FROM finish();
ROLLBACK;
