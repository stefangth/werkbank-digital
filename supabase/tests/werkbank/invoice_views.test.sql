-- Werkbank Teil 4 (R3, R4): invoice branch of document_totals, invoice_list, immutable invoice files.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(35);

SET LOCAL timezone = 'UTC';

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000d1','authenticated','authenticated','iv-admin-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000d2','authenticated','authenticated','iv-admin-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000d1','IV Org A','iv-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000d2','IV Org B','iv-org-b','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000d1','aaaaaaaa-0000-4000-a000-0000000000d1','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000000d2','aaaaaaaa-0000-4000-a000-0000000000d2','admin');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, first_name, last_name, company_name, street, postal_code, city) VALUES
  ('cccccccc-0000-4000-c000-0000000000d1','bbbbbbbb-0000-4000-b000-0000000000d1','K-1','private','Hans','Müller',NULL,'Weg 1','01067','Dresden'),
  ('cccccccc-0000-4000-c000-0000000000d2','bbbbbbbb-0000-4000-b000-0000000000d1','K-2','property_manager',NULL,NULL,'HV Nord GmbH','Ring 2','01069','Dresden');
INSERT INTO werkbank.properties (id, org_id, customer_id, name, street, postal_code, city) VALUES
  ('dddddddd-0000-4000-d000-0000000000d1','bbbbbbbb-0000-4000-b000-0000000000d1','cccccccc-0000-4000-c000-0000000000d2',
   'Objekt Linden','Lindenstr. 5','01099','Dresden');
INSERT INTO werkbank.company_profiles (org_id, company_name, street, postal_code, city, email, tax_number, iban, payment_due_days) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000d1','Werkbank GmbH','Hof 3','01067','Dresden','info@werkbank.test','201/123/45678',
   'DE89370400440532013000',14);
INSERT INTO werkbank.orders (id, org_id, order_no, customer_id, property_id, subject, status, completed_at, discount_percent) VALUES
  ('33333333-0000-4000-a000-0000000000d1','bbbbbbbb-0000-4000-b000-0000000000d1','AU-1','cccccccc-0000-4000-c000-0000000000d1',
   NULL,'Bad','done','2026-10-05 10:00:00+00', 0),
  ('33333333-0000-4000-a000-0000000000d2','bbbbbbbb-0000-4000-b000-0000000000d1','AU-2','cccccccc-0000-4000-c000-0000000000d2',
   'dddddddd-0000-4000-d000-0000000000d1','Dach','done','2026-10-01 08:00:00+00', 10);
INSERT INTO werkbank.document_items (org_id, order_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000d1','33333333-0000-4000-a000-0000000000d1',0,'item','Rohr',2,'HUR',10,5,19),
  ('bbbbbbbb-0000-4000-b000-0000000000d1','33333333-0000-4000-a000-0000000000d1',1,'item','Dichtung',1,'H87',4,0,7),
  ('bbbbbbbb-0000-4000-b000-0000000000d1','33333333-0000-4000-a000-0000000000d2',0,'item','Ziegel',10,'H87',2,3,19);
-- R1 fixture: rounding per VAT rate with a discount (a draft invoice, no order).
INSERT INTO werkbank.invoices (id, org_id, customer_id, discount_percent, subject) VALUES
  ('66666666-0000-4000-a000-0000000000d9','bbbbbbbb-0000-4000-b000-0000000000d1','cccccccc-0000-4000-c000-0000000000d1',3,'Rundung');
INSERT INTO werkbank.document_items (org_id, invoice_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000d1','66666666-0000-4000-a000-0000000000d9',0,'item','A',0.335,'HUR',1.00,0.00,19),
  ('bbbbbbbb-0000-4000-b000-0000000000d1','66666666-0000-4000-a000-0000000000d9',1,'item','B',0.335,'HUR',1.00,0.00,19),
  ('bbbbbbbb-0000-4000-b000-0000000000d1','66666666-0000-4000-a000-0000000000d9',2,'item','C',0.335,'HUR',1.00,0.00,19),
  ('bbbbbbbb-0000-4000-b000-0000000000d1','66666666-0000-4000-a000-0000000000d9',3,'item','D',3,'H87',12.50,0.00,7);
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;
CREATE OR REPLACE FUNCTION pg_temp.id(_key text) RETURNS uuid LANGUAGE sql AS $$
  SELECT nullif(current_setting('iv.' || _key, true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(text) TO PUBLIC;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000d1');
SET LOCAL ROLE authenticated;

-- document_totals: the invoice branch -----------------------------------------------------------
SELECT set_config('iv.inv1', werkbank.create_invoice_from_order('33333333-0000-4000-a000-0000000000d1')::text, true);
SELECT set_config('iv.inv2', werkbank.create_invoice_from_order('33333333-0000-4000-a000-0000000000d2')::text, true);

SELECT results_eq(
  $$SELECT net_total, discount_total, vat_total, gross_total, labour_total, vat_breakdown
    FROM werkbank.document_totals WHERE invoice_id = pg_temp.id('inv1')$$,
  $$SELECT net_total, discount_total, vat_total, gross_total, labour_total, vat_breakdown
    FROM werkbank.document_totals WHERE order_id = '33333333-0000-4000-a000-0000000000d1'$$,
  'an invoice has the totals and the VAT breakdown of its order');
SELECT results_eq(
  $$SELECT net_total, gross_total FROM werkbank.document_totals WHERE invoice_id = pg_temp.id('inv1')$$,
  $$VALUES (34.00::numeric, 39.98::numeric)$$,
  'the invoice totals are the known figures (30 at 19 percent, 4 at 7 percent)');
SELECT results_eq(
  $$SELECT net_total, gross_total FROM werkbank.document_totals WHERE invoice_id = pg_temp.id('inv2')$$,
  $$SELECT net_total, gross_total FROM werkbank.document_totals WHERE order_id = '33333333-0000-4000-a000-0000000000d2'$$,
  'an invoice with a discount has the totals of its order');
SELECT results_eq(
  $$SELECT (quote_id IS NULL), (order_id IS NULL), (invoice_id IS NULL) FROM werkbank.document_totals
    WHERE order_id = '33333333-0000-4000-a000-0000000000d1'$$,
  $$VALUES (true, false, true)$$,
  'an order row has no quote_id and no invoice_id');
SELECT is((SELECT count(*)::int FROM werkbank.document_totals WHERE invoice_id IS NOT NULL AND (quote_id IS NOT NULL OR order_id IS NOT NULL)),
  0, 'an invoice row sets only invoice_id');

-- R1 rounding fixture
SELECT results_eq(
  $$SELECT net_total, discount_total, vat_total, gross_total FROM werkbank.document_totals
    WHERE invoice_id = '66666666-0000-4000-a000-0000000000d9'$$,
  $$VALUES (38.52::numeric, 1.15::numeric, 2.74::numeric, 40.11::numeric)$$,
  'rounding fixture: net 38.52, discount 1.15, VAT 2.74, gross 40.11');
SELECT results_eq(
  $$SELECT (e->>'rate')::numeric, (e->>'net')::numeric, (e->>'discounted_net')::numeric, (e->>'vat')::numeric
    FROM werkbank.document_totals t, jsonb_array_elements(t.vat_breakdown) e
    WHERE t.invoice_id = '66666666-0000-4000-a000-0000000000d9' ORDER BY 1 DESC$$,
  $$VALUES (19::numeric, 1.02::numeric, 0.99::numeric, 0.19::numeric),
           (7::numeric, 37.50::numeric, 36.38::numeric, 2.55::numeric)$$,
  'rounding fixture: breakdown per rate');

-- quote_list and order_list keep their columns --------------------------------------------------
SELECT is((SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns
  WHERE table_schema = 'werkbank' AND table_name = 'quote_list'),
  ARRAY['id','org_id','quote_no','version','superseded_by','superseded_from_status','customer_id','property_id','contact_id',
    'location_note','subject','intro_text','closing_text','payment_terms_text','discount_percent','valid_until','status',
    'sent_at','sent_to','pdf_path','pdf_sha256','accepted_pdf_path','link_revoked_at','created_at','updated_at',
    'customer_name','property_name','net_total','discount_total','vat_total','gross_total','labour_total','vat_breakdown',
    'is_expired','has_order'],
  'quote_list keeps its Teil 3 columns');
SELECT is((SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns
  WHERE table_schema = 'werkbank' AND table_name = 'order_list'),
  ARRAY['id','org_id','order_no','quote_id','customer_id','property_id','contact_id','location_note','subject',
    'discount_percent','notes','status','scheduled_date','scheduled_time','completed_at','cancelled_at','created_at','updated_at',
    'customer_name','property_name','net_total','discount_total','vat_total','gross_total','labour_total','vat_breakdown',
    'technician_ids','technician_names'],
  'order_list keeps its Teil 3 columns');
SELECT is((SELECT gross_total FROM werkbank.order_list WHERE id = '33333333-0000-4000-a000-0000000000d1'), 39.98::numeric,
  'order_list still reads the order totals');

-- invoice_list ----------------------------------------------------------------------------------
SELECT is((SELECT customer_name FROM werkbank.invoice_list WHERE id = pg_temp.id('inv1')), 'Hans Müller'::text,
  'invoice_list shows the customer name');
SELECT is((SELECT property_name FROM werkbank.invoice_list WHERE id = pg_temp.id('inv2')), 'Objekt Linden'::text,
  'invoice_list shows the property name');
SELECT is((SELECT customer_name FROM werkbank.invoice_list WHERE id = pg_temp.id('inv2')), 'HV Nord GmbH'::text,
  'invoice_list prefers the company name');
SELECT results_eq(
  $$SELECT net_total, gross_total FROM werkbank.invoice_list WHERE id = pg_temp.id('inv1')$$,
  $$VALUES (34.00::numeric, 39.98::numeric)$$,
  'invoice_list carries the totals');
SELECT is((SELECT cancelled_by_no FROM werkbank.invoice_list WHERE id = pg_temp.id('inv1')), NULL::text,
  'no cancelled_by_no before a cancellation');

SELECT is((werkbank.finalize_invoice(pg_temp.id('inv1'))).invoice_no, 'RE-0001', 'finalize RE-0001');
SELECT set_config('iv.can1', werkbank.cancel_invoice(pg_temp.id('inv1'))::text, true);
SELECT is((SELECT cancelled_by_no FROM werkbank.invoice_list WHERE id = pg_temp.id('inv1')), NULL::text,
  'a cancellation draft does not yet cancel the original');
SELECT is((werkbank.finalize_invoice(pg_temp.id('can1'))).invoice_no, 'RE-0002', 'finalize cancellation RE-0002');
SELECT is((SELECT cancelled_by_no FROM werkbank.invoice_list WHERE id = pg_temp.id('inv1')), 'RE-0002'::text,
  'the original shows the number of its issued cancellation');
SELECT is((SELECT cancels_no FROM werkbank.invoice_list WHERE id = pg_temp.id('can1')), 'RE-0001'::text,
  'the cancellation shows the number of the original');
SELECT is((SELECT cancels_no FROM werkbank.invoice_list WHERE id = pg_temp.id('inv1')), NULL::text,
  'the original has no cancels_no');

-- Another org sees nothing --------------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000d2');
SELECT is((SELECT count(*)::int FROM werkbank.invoice_list), 0, 'the admin of another org sees no invoice_list rows');
SELECT is((SELECT count(*)::int FROM werkbank.document_totals WHERE invoice_id IS NOT NULL), 0,
  'the admin of another org sees no invoice totals');
RESET ROLE;

-- The org lookup must not depend on the caller: supabase_storage_admin cannot read
-- public.organizations, and an RLS-bound caller would see "no org" and be let through.
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'werkbank.protect_invoice_files()'::regprocedure), true,
  'protect_invoice_files runs as its owner');

-- Storage: invoice files are immutable -------------------------------------------------------------------
SET LOCAL storage.allow_delete_query = 'true';
SET LOCAL ROLE service_role;
SELECT lives_ok($$INSERT INTO storage.objects (bucket_id, name) VALUES
  ('werkbank-documents', 'bbbbbbbb-0000-4000-b000-0000000000d1/invoices/x.pdf'),
  ('werkbank-documents', 'bbbbbbbb-0000-4000-b000-0000000000d1/quotes/q.pdf'),
  ('werkbank-assets', 'bbbbbbbb-0000-4000-b000-0000000000d1/invoices/other.pdf')$$,
  'the service role can write an invoice file');
SELECT throws_ok($$UPDATE storage.objects SET name = 'bbbbbbbb-0000-4000-b000-0000000000d1/invoices/y.pdf'
  WHERE name = 'bbbbbbbb-0000-4000-b000-0000000000d1/invoices/x.pdf'$$,
  '55000', 'invoice_locked', 'an invoice file cannot be updated');
SELECT throws_ok($$DELETE FROM storage.objects WHERE name = 'bbbbbbbb-0000-4000-b000-0000000000d1/invoices/x.pdf'$$,
  '55000', 'invoice_locked', 'an invoice file cannot be deleted');
SELECT throws_ok($$UPDATE storage.objects SET metadata = '{"size": 1}'::jsonb
  WHERE name = 'bbbbbbbb-0000-4000-b000-0000000000d1/invoices/x.pdf'$$,
  '55000', 'invoice_locked', 'an invoice file cannot be overwritten (metadata)');
SELECT throws_ok($$UPDATE storage.objects SET version = 'v2'
  WHERE name = 'bbbbbbbb-0000-4000-b000-0000000000d1/invoices/x.pdf'$$,
  '55000', 'invoice_locked', 'an invoice file cannot be overwritten (version)');
SELECT lives_ok($$UPDATE storage.objects SET last_accessed_at = now(), updated_at = now()
  WHERE name = 'bbbbbbbb-0000-4000-b000-0000000000d1/invoices/x.pdf'$$,
  'the Storage service may still stamp access times on an invoice file');
SELECT lives_ok($$DELETE FROM storage.objects WHERE name = 'bbbbbbbb-0000-4000-b000-0000000000d1/quotes/q.pdf'$$,
  'a quote file can still be deleted');
SELECT lives_ok($$DELETE FROM storage.objects WHERE bucket_id = 'werkbank-assets'$$,
  'the same path in another bucket can be deleted');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM storage.objects WHERE name = 'bbbbbbbb-0000-4000-b000-0000000000d1/invoices/x.pdf'), 1,
  'the invoice file is still there');

-- Once the org is deleted (erasure, ADR-0013 removal), its invoice files can be deleted.
SELECT lives_ok($$DELETE FROM public.organizations WHERE id = 'bbbbbbbb-0000-4000-b000-0000000000d1'$$,
  'the org with issued invoices can be deleted');
SET LOCAL ROLE service_role;
SELECT lives_ok($$DELETE FROM storage.objects WHERE name = 'bbbbbbbb-0000-4000-b000-0000000000d1/invoices/x.pdf'$$,
  'after the org is deleted its invoice file can be deleted');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
