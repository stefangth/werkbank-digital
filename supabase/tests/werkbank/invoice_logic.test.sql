-- Werkbank Teil 4 (R2): invoice lock, order status 'invoiced', the invoice number range and its
-- guard, and the RPCs create_invoice_from_order, finalize_invoice, cancel_invoice, copy_invoice.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(93);

-- Berlin dates must not depend on the session time zone.
SET LOCAL timezone = 'UTC';

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000c1','authenticated','authenticated','il-admin-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000c2','authenticated','authenticated','il-producer-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000c3','authenticated','authenticated','il-tech-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000c4','authenticated','authenticated','il-admin-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000c1','IL Org A','il-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000c2','IL Org B','il-org-b','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000c1','aaaaaaaa-0000-4000-a000-0000000000c1','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000000c1','aaaaaaaa-0000-4000-a000-0000000000c2','producer'),
  ('bbbbbbbb-0000-4000-b000-0000000000c1','aaaaaaaa-0000-4000-a000-0000000000c3','artist'),
  ('bbbbbbbb-0000-4000-b000-0000000000c2','aaaaaaaa-0000-4000-a000-0000000000c4','admin');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, first_name, last_name, company_name, street, postal_code, city,
    vat_id, invoice_email) VALUES
  ('cccccccc-0000-4000-c000-0000000000c1','bbbbbbbb-0000-4000-b000-0000000000c1','K-1','private','Hans','Müller',NULL,
   'Weg 1','01067','Dresden',NULL,NULL),
  ('cccccccc-0000-4000-c000-0000000000c2','bbbbbbbb-0000-4000-b000-0000000000c1','K-2','property_manager',NULL,NULL,'HV Nord GmbH',
   'Ring 2','01069','Dresden','DE123456789','rechnung@hv-nord.de');
INSERT INTO werkbank.properties (id, org_id, customer_id, name, street, postal_code, city,
    billing_name, billing_street, billing_postal_code, billing_city, billing_country_code) VALUES
  ('dddddddd-0000-4000-d000-0000000000c2','bbbbbbbb-0000-4000-b000-0000000000c1','cccccccc-0000-4000-c000-0000000000c2',
   'Objekt Linden','Lindenstr. 5','01099','Dresden','WEG Lindenstr. 5','Postfach 12','01001','Dresden','DE');
INSERT INTO werkbank.company_profiles (org_id, company_name, street, postal_code, city, email, tax_number,
    invoice_intro, invoice_closing, payment_terms_text, payment_due_days) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000c1','Werkbank GmbH','Hof 3','01067','Dresden','info@werkbank.test','201/123/45678',
   'Wir berechnen','Danke','Zahlbar ohne Abzug',14);
-- Orders: c1 done (no property), c2 in progress, c3 done for the property with a billing address.
-- 23:30 UTC on 5 October is 6 October in Berlin.
INSERT INTO werkbank.orders (id, org_id, order_no, customer_id, property_id, subject, status, completed_at) VALUES
  ('33333333-0000-4000-a000-0000000000c1','bbbbbbbb-0000-4000-b000-0000000000c1','AU-1','cccccccc-0000-4000-c000-0000000000c1',
   NULL,'Bad','done','2026-10-05 23:30:00+00'),
  ('33333333-0000-4000-a000-0000000000c2','bbbbbbbb-0000-4000-b000-0000000000c1','AU-2','cccccccc-0000-4000-c000-0000000000c1',
   NULL,'Küche','in_progress',NULL),
  ('33333333-0000-4000-a000-0000000000c3','bbbbbbbb-0000-4000-b000-0000000000c1','AU-3','cccccccc-0000-4000-c000-0000000000c2',
   'dddddddd-0000-4000-d000-0000000000c2','Dach','done','2026-10-01 08:00:00+00');
INSERT INTO werkbank.document_items (id, org_id, order_id, sort_order, kind, name, description, quantity, unit_code,
    labour_price, material_price, vat_rate) VALUES
  ('22222222-0000-4000-a000-0000000000c1','bbbbbbbb-0000-4000-b000-0000000000c1','33333333-0000-4000-a000-0000000000c1',0,'title','Bad',NULL,NULL,NULL,NULL,NULL,NULL),
  ('22222222-0000-4000-a000-0000000000c2','bbbbbbbb-0000-4000-b000-0000000000c1','33333333-0000-4000-a000-0000000000c1',1,'item','Rohr',NULL,2,'HUR',10,5,19),
  ('22222222-0000-4000-a000-0000000000c3','bbbbbbbb-0000-4000-b000-0000000000c1','33333333-0000-4000-a000-0000000000c1',2,'text',NULL,'Hinweis',NULL,NULL,NULL,NULL,NULL),
  ('22222222-0000-4000-a000-0000000000c4','bbbbbbbb-0000-4000-b000-0000000000c1','33333333-0000-4000-a000-0000000000c3',0,'item','Ziegel',NULL,10,'H87',2,3,19);
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.id(_key text) RETURNS uuid LANGUAGE sql AS $$
  SELECT nullif(current_setting('il.' || _key, true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;

-- The DETAIL of the error a statement raises (NULL when it succeeds).
CREATE OR REPLACE FUNCTION pg_temp.err_detail(_sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE d text;
BEGIN
  EXECUTE _sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS d = PG_EXCEPTION_DETAIL;
  RETURN d;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.err_detail(text) TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.invoice_next() RETURNS bigint LANGUAGE sql AS $$
  SELECT next_value FROM werkbank.number_ranges
  WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000c1' AND key = 'invoice'
$$;
GRANT EXECUTE ON FUNCTION pg_temp.invoice_next() TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.berlin_today() RETURNS date LANGUAGE sql AS $$
  SELECT (now() AT TIME ZONE 'Europe/Berlin')::date
$$;
GRANT EXECUTE ON FUNCTION pg_temp.berlin_today() TO PUBLIC;

-- create_invoice_from_order -------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000c2');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT werkbank.create_invoice_from_order('33333333-0000-4000-a000-0000000000c2')$$,
  '22023', 'order_not_done', 'an invoice is only created from a done order');
SELECT set_config('il.inv1', werkbank.create_invoice_from_order('33333333-0000-4000-a000-0000000000c1')::text, true);
SELECT results_eq(
  $$SELECT type, status, order_id, customer_id, property_id, subject, intro_text, closing_text, payment_terms_text,
      payment_due_days, service_date_from, invoice_no
    FROM werkbank.invoices WHERE id = pg_temp.id('inv1')$$,
  $$VALUES ('invoice'::text, 'draft'::text, '33333333-0000-4000-a000-0000000000c1'::uuid, 'cccccccc-0000-4000-c000-0000000000c1'::uuid,
      NULL::uuid, 'Bad'::text, 'Wir berechnen'::text, 'Danke'::text, 'Zahlbar ohne Abzug'::text, 14, '2026-10-06'::date, NULL::text)$$,
  'create_invoice_from_order copies the header, profile texts and the Berlin date of completed_at');
SELECT results_eq(
  $$SELECT sort_order, kind, source_item_id FROM werkbank.document_items WHERE invoice_id = pg_temp.id('inv1') ORDER BY sort_order$$,
  $$VALUES (0, 'title'::text, '22222222-0000-4000-a000-0000000000c1'::uuid),
           (1, 'item'::text, '22222222-0000-4000-a000-0000000000c2'::uuid),
           (2, 'text'::text, '22222222-0000-4000-a000-0000000000c3'::uuid)$$,
  'create_invoice_from_order copies the items with source_item_id');
SELECT throws_ok($$SELECT werkbank.create_invoice_from_order('33333333-0000-4000-a000-0000000000c1')$$,
  '23505', NULL, 'a second invoice for the same order fails on the partial unique index');

-- Item edits bump the draft invoice (touch trigger of Task 2).
RESET ROLE;
SET session_replication_role = replica;
UPDATE werkbank.invoices SET updated_at = '2000-01-01' WHERE id = pg_temp.id('inv1');
SET session_replication_role = DEFAULT;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000c2');
SET LOCAL ROLE authenticated;
INSERT INTO werkbank.document_items (id, org_id, invoice_id, sort_order, kind, description)
  VALUES ('22222222-0000-4000-a000-0000000000c9','bbbbbbbb-0000-4000-b000-0000000000c1',pg_temp.id('inv1'),3,'text','Temp');
SELECT is((SELECT updated_at FROM werkbank.invoices WHERE id = pg_temp.id('inv1')), now(),
  'an item insert bumps the draft invoice updated_at');
SELECT lives_ok($$DELETE FROM werkbank.document_items WHERE id = '22222222-0000-4000-a000-0000000000c9'$$,
  'an item of a draft invoice can be deleted');

-- User writes the finalize step owns ---------------------------------------------------
SELECT throws_ok($$INSERT INTO werkbank.invoices (org_id, customer_id, status, invoice_no, seller_snapshot, buyer_snapshot)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000c1','cccccccc-0000-4000-c000-0000000000c1','issued','RE-9999','{}','{}')$$,
  '22023', 'invalid_transition', 'a user cannot insert an issued invoice');
SELECT throws_ok($$INSERT INTO werkbank.invoices (org_id, customer_id, invoice_no)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000c1','cccccccc-0000-4000-c000-0000000000c1','RE-9999')$$,
  '55000', 'invoice_locked', 'a user cannot choose the invoice number');
SELECT throws_ok(format($$INSERT INTO werkbank.invoices (org_id, customer_id, type, cancels_invoice_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000c1','cccccccc-0000-4000-c000-0000000000c1','cancellation','%s')$$, pg_temp.id('inv1')),
  '22023', 'invalid_transition', 'a user cannot insert a cancellation');
SELECT throws_ok($$UPDATE werkbank.invoices SET status = 'issued' WHERE id = pg_temp.id('inv1')$$,
  '22023', 'invalid_transition', 'a user cannot issue by setting the status');
SELECT throws_ok($$UPDATE werkbank.invoices SET issue_date = current_date WHERE id = pg_temp.id('inv1')$$,
  '55000', 'invoice_locked', 'a user cannot write issue_date on a draft');

-- finalize blockers: nothing is drawn -----------------------------------------------------
INSERT INTO werkbank.invoices (id, org_id, customer_id)
  VALUES ('66666666-0000-4000-a000-0000000000c9','bbbbbbbb-0000-4000-b000-0000000000c1','cccccccc-0000-4000-c000-0000000000c1');
SELECT throws_ok($$SELECT werkbank.finalize_invoice('66666666-0000-4000-a000-0000000000c9')$$,
  '22023', 'invoice_not_ready', 'finalize of an incomplete draft fails');
SELECT is(pg_temp.err_detail($$SELECT werkbank.finalize_invoice('66666666-0000-4000-a000-0000000000c9')$$),
  'no_items,no_service_date,profile_incomplete', 'the detail lists the blockers in order (no IBAN = incomplete profile)');
SELECT is(pg_temp.err_detail(format($$SELECT werkbank.finalize_invoice('%s')$$, pg_temp.id('inv1'))),
  'profile_incomplete', 'a complete draft is blocked only by the profile without IBAN');
SELECT is(pg_temp.invoice_next(), NULL, 'failed finalizes do not touch the invoice range');
RESET ROLE;
UPDATE werkbank.company_profiles SET iban = 'DE89370400440532013000' WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000c1';

-- Reopened order: the draft cannot be issued until the order is done again.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000c2');
SET LOCAL ROLE authenticated;
UPDATE werkbank.orders SET status = 'in_progress' WHERE id = '33333333-0000-4000-a000-0000000000c1';
SELECT throws_ok(format($$SELECT werkbank.finalize_invoice('%s')$$, pg_temp.id('inv1')),
  '22023', 'order_not_done', 'finalize fails while the order is reopened');
SELECT is(pg_temp.invoice_next(), NULL, 'the failed finalize did not touch the range');
UPDATE werkbank.orders SET status = 'done' WHERE id = '33333333-0000-4000-a000-0000000000c1';

-- finalize -------------------------------------------------------------------------------
SELECT is((werkbank.finalize_invoice(pg_temp.id('inv1'))).invoice_no, 'RE-0001', 'finalize draws RE-0001');
SELECT results_eq(
  $$SELECT status, issue_date, due_date, issued_at FROM werkbank.invoices WHERE id = pg_temp.id('inv1')$$,
  $$SELECT 'issued'::text, pg_temp.berlin_today(), pg_temp.berlin_today() + 14, now()$$,
  'finalize sets status, Berlin issue date, due date and issued_at');
SELECT is((SELECT status FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000000c1'), 'invoiced',
  'finalize sets the order to invoiced');
SELECT is(pg_temp.invoice_next(), 2::bigint, 'the invoice range is seeded and advanced to 2');
SELECT results_eq(
  $$SELECT key, prefix, padding FROM werkbank.number_ranges WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000c1' AND key = 'invoice'$$,
  $$VALUES ('invoice'::text, 'RE-'::text, 4)$$,
  'the invoice range is seeded with RE- and padding 4');
SELECT is((SELECT seller_snapshot FROM werkbank.invoices WHERE id = pg_temp.id('inv1')),
  (SELECT to_jsonb(p) - 'org_id' - 'created_at' - 'updated_at' FROM werkbank.company_profiles p
   WHERE p.org_id = 'bbbbbbbb-0000-4000-b000-0000000000c1'),
  'seller_snapshot is the company profile without org_id and timestamps');
SELECT is((SELECT buyer_snapshot FROM werkbank.invoices WHERE id = pg_temp.id('inv1')),
  jsonb_build_object('name', 'Müller, Hans', 'street', 'Weg 1', 'postal_code', '01067', 'city', 'Dresden',
    'country_code', 'DE', 'customer_no', 'K-1', 'vat_id', NULL, 'invoice_email', NULL, 'is_private', true,
    'billing_override', false, 'property', NULL),
  'a private customer without property: the buyer is the customer address');
SELECT throws_ok(format($$SELECT werkbank.finalize_invoice('%s')$$, pg_temp.id('inv1')),
  '22023', 'invalid_transition', 'a second finalize fails');
SELECT is(pg_temp.invoice_next(), 2::bigint, 'the second finalize did not draw a number');
SELECT is(pg_temp.err_detail($$SELECT werkbank.finalize_invoice('66666666-0000-4000-a000-0000000000c9')$$),
  'no_items,no_service_date', 'the empty draft is still blocked');
SELECT is(pg_temp.invoice_next(), 2::bigint, 'blocked finalizes leave the range gapless');

-- Lock after issue: producer --------------------------------------------------------------
SELECT throws_ok(format($$UPDATE werkbank.invoices SET subject = 'Neu' WHERE id = '%s'$$, pg_temp.id('inv1')),
  '55000', 'invoice_locked', 'producer cannot change the subject of an issued invoice');
SELECT throws_ok(format($$UPDATE werkbank.document_items SET name = 'Neu' WHERE invoice_id = '%s' AND kind = 'item'$$, pg_temp.id('inv1')),
  '55000', 'invoice_locked', 'producer cannot change an item of an issued invoice');
SELECT throws_ok(format($$INSERT INTO werkbank.document_items (org_id, invoice_id, sort_order, kind, description)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000c1','%s',9,'text','Neu')$$, pg_temp.id('inv1')),
  '55000', 'invoice_locked', 'producer cannot add an item to an issued invoice');
SELECT throws_ok(format($$DELETE FROM werkbank.document_items WHERE invoice_id = '%s' AND kind = 'text'$$, pg_temp.id('inv1')),
  '55000', 'invoice_locked', 'producer cannot delete an item of an issued invoice');
SELECT throws_ok(format($$DELETE FROM werkbank.invoices WHERE id = '%s'$$, pg_temp.id('inv1')),
  '55000', 'invoice_locked', 'producer cannot delete an issued invoice');
SELECT throws_ok(format($$UPDATE werkbank.invoices SET status = 'cancelled' WHERE id = '%s'$$, pg_temp.id('inv1')),
  '22023', 'invalid_transition', 'producer cannot cancel by setting the status');
SELECT throws_ok(format($$UPDATE werkbank.invoices SET pdf_path = 'x.pdf' WHERE id = '%s'$$, pg_temp.id('inv1')),
  '55000', 'invoice_locked', 'producer cannot set pdf_path');
SELECT throws_ok(format($$UPDATE werkbank.document_items SET invoice_id = '66666666-0000-4000-a000-0000000000c9'
  WHERE invoice_id = '%s' AND kind = 'text'$$, pg_temp.id('inv1')),
  '22023', 'item_reparent', 'an invoice item cannot move to another invoice');
UPDATE werkbank.customers SET street = 'Neue Str. 9' WHERE id = 'cccccccc-0000-4000-c000-0000000000c1';
SELECT is((SELECT buyer_snapshot ->> 'street' FROM werkbank.invoices WHERE id = pg_temp.id('inv1')), 'Weg 1',
  'a later customer edit leaves the buyer snapshot unchanged');
RESET ROLE;

-- Lock after issue: admin -------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000c1');
SET LOCAL ROLE authenticated;
SELECT throws_ok(format($$UPDATE werkbank.invoices SET subject = 'Neu' WHERE id = '%s'$$, pg_temp.id('inv1')),
  '55000', 'invoice_locked', 'admin cannot change the subject of an issued invoice');
SELECT throws_ok(format($$UPDATE werkbank.document_items SET name = 'Neu' WHERE invoice_id = '%s' AND kind = 'item'$$, pg_temp.id('inv1')),
  '55000', 'invoice_locked', 'admin cannot change an item of an issued invoice');
SELECT throws_ok(format($$INSERT INTO werkbank.document_items (org_id, invoice_id, sort_order, kind, description)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000c1','%s',9,'text','Neu')$$, pg_temp.id('inv1')),
  '55000', 'invoice_locked', 'admin cannot add an item to an issued invoice');
SELECT throws_ok(format($$DELETE FROM werkbank.invoices WHERE id = '%s'$$, pg_temp.id('inv1')),
  '55000', 'invoice_locked', 'admin cannot delete an issued invoice');
RESET ROLE;

-- Service role: pdf once, send columns always ---------------------------------------------
SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE werkbank.invoices SET pdf_path = 'a/invoices/d.pdf' WHERE id = '66666666-0000-4000-a000-0000000000c9'$$,
  '55000', 'invoice_locked', 'the service role cannot set pdf_path on a draft');
SELECT lives_ok(format($$UPDATE werkbank.invoices SET pdf_path = 'a/invoices/x.pdf', pdf_sha256 = 'abc' WHERE id = '%s'$$, pg_temp.id('inv1')),
  'the service role sets pdf_path and pdf_sha256 once');
SELECT throws_ok(format($$UPDATE werkbank.invoices SET pdf_path = 'a/invoices/y.pdf' WHERE id = '%s'$$, pg_temp.id('inv1')),
  '55000', 'invoice_locked', 'the service role cannot change pdf_path again');
SELECT lives_ok(format($$UPDATE werkbank.invoices SET sent_at = now(), sent_to = '{a@b.de}' WHERE id = '%s'$$, pg_temp.id('inv1')),
  'the service role sets sent_at and sent_to');
SELECT throws_ok(format($$UPDATE werkbank.invoices SET subject = 'Neu' WHERE id = '%s'$$, pg_temp.id('inv1')),
  '55000', 'invoice_locked', 'the service role cannot change the header of an issued invoice');
RESET ROLE;

-- Order status 'invoiced' -------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000c2');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$UPDATE werkbank.orders SET status = 'invoiced' WHERE id = '33333333-0000-4000-a000-0000000000c3'$$,
  '22023', 'invalid_transition', 'a user cannot set an order to invoiced');
SELECT throws_ok($$UPDATE werkbank.orders SET status = 'in_progress' WHERE id = '33333333-0000-4000-a000-0000000000c1'$$,
  '22023', 'invalid_transition', 'an invoiced order cannot be reopened');
SELECT throws_ok($$UPDATE werkbank.orders SET status = 'done' WHERE id = '33333333-0000-4000-a000-0000000000c1'$$,
  '22023', 'invalid_transition', 'a user cannot move an order from invoiced back to done');
SELECT throws_ok($$UPDATE werkbank.orders SET subject = 'Neu' WHERE id = '33333333-0000-4000-a000-0000000000c1'$$,
  '55000', 'order_locked', 'the header of an invoiced order is locked');
SELECT throws_ok($$INSERT INTO werkbank.document_items (org_id, order_id, sort_order, kind, description)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000c1','33333333-0000-4000-a000-0000000000c1',9,'text','Neu')$$,
  '55000', 'order_locked', 'the items of an invoiced order are locked');

-- cancel_invoice ------------------------------------------------------------------------------
SELECT throws_ok($$SELECT werkbank.cancel_invoice('66666666-0000-4000-a000-0000000000c9')$$,
  '22023', 'invalid_transition', 'a draft cannot be cancelled');
SELECT set_config('il.can1', werkbank.cancel_invoice(pg_temp.id('inv1'))::text, true);
SELECT results_eq(
  $$SELECT type, status, cancels_invoice_id, order_id, customer_id, subject, intro_text, service_date_from, invoice_no
    FROM werkbank.invoices WHERE id = pg_temp.id('can1')$$,
  $$SELECT 'cancellation'::text, 'draft'::text, pg_temp.id('inv1'), '33333333-0000-4000-a000-0000000000c1'::uuid,
      'cccccccc-0000-4000-c000-0000000000c1'::uuid, 'Bad'::text,
      'Storno zu RE-0001 vom ' || to_char(pg_temp.berlin_today(), 'DD.MM.YYYY'), '2026-10-06'::date, NULL::text$$,
  'cancel_invoice creates a cancellation draft with the original header and the Storno intro');
SELECT is((SELECT count(*)::int FROM werkbank.document_items WHERE invoice_id = pg_temp.id('can1')),
  (SELECT count(*)::int FROM werkbank.document_items WHERE invoice_id = pg_temp.id('inv1')),
  'the cancellation copies all items');
SELECT throws_ok(format($$UPDATE werkbank.invoices SET customer_id = 'cccccccc-0000-4000-c000-0000000000c2' WHERE id = '%s'$$, pg_temp.id('can1')),
  '55000', 'invoice_locked', 'the customer of a cancellation draft cannot change');
SELECT throws_ok(format($$UPDATE werkbank.invoices SET discount_percent = 10 WHERE id = '%s'$$, pg_temp.id('can1')),
  '55000', 'invoice_locked', 'the discount of a cancellation draft cannot change');
SELECT throws_ok(format($$DELETE FROM werkbank.document_items WHERE invoice_id = '%s' AND kind = 'text'$$, pg_temp.id('can1')),
  '55000', 'invoice_locked', 'an item of a cancellation draft cannot be deleted');
SELECT throws_ok(format($$INSERT INTO werkbank.document_items (org_id, invoice_id, sort_order, kind, description)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000c1','%s',9,'text','Neu')$$, pg_temp.id('can1')),
  '55000', 'invoice_locked', 'an item cannot be added to a cancellation draft');
SELECT lives_ok(format($$UPDATE werkbank.invoices SET intro_text = 'Storno, neu formuliert', payment_due_days = 0
  WHERE id = '%s'$$, pg_temp.id('can1')),
  'the texts and payment days of a cancellation draft stay editable');
SELECT lives_ok(format($$DELETE FROM werkbank.invoices WHERE id = '%s'$$, pg_temp.id('can1')),
  'a cancellation draft can be deleted with its items');
SELECT set_config('il.can1', werkbank.cancel_invoice(pg_temp.id('inv1'))::text, true);
SELECT throws_ok(format($$SELECT werkbank.cancel_invoice('%s')$$, pg_temp.id('inv1')),
  '23505', NULL, 'a second cancellation of the same invoice fails');
SELECT is((werkbank.finalize_invoice(pg_temp.id('can1'))).invoice_no, 'RE-0002', 'the cancellation draws RE-0002');
SELECT is((SELECT buyer_snapshot FROM werkbank.invoices WHERE id = pg_temp.id('can1')),
  (SELECT buyer_snapshot FROM werkbank.invoices WHERE id = pg_temp.id('inv1')),
  'the cancellation keeps the original buyer although the customer street changed since');
SELECT is((SELECT seller_snapshot FROM werkbank.invoices WHERE id = pg_temp.id('can1')),
  (SELECT to_jsonb(p) - 'org_id' - 'created_at' - 'updated_at' FROM werkbank.company_profiles p
   WHERE p.org_id = 'bbbbbbbb-0000-4000-b000-0000000000c1'),
  'the cancellation takes a fresh seller snapshot');
SELECT is((SELECT status FROM werkbank.invoices WHERE id = pg_temp.id('inv1')), 'cancelled',
  'finalizing the cancellation cancels the original');
SELECT is((SELECT status FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000000c1'), 'done',
  'finalizing the cancellation sets the order back to done');
SELECT throws_ok(format($$SELECT werkbank.cancel_invoice('%s')$$, pg_temp.id('can1')),
  '22023', 'invalid_transition', 'a cancellation cannot be cancelled');

-- Billing override -----------------------------------------------------------------------------
SELECT set_config('il.inv2', werkbank.create_invoice_from_order('33333333-0000-4000-a000-0000000000c3')::text, true);
SELECT is((werkbank.finalize_invoice(pg_temp.id('inv2'))).invoice_no, 'RE-0003', 'the next invoice draws RE-0003');
SELECT is((SELECT buyer_snapshot FROM werkbank.invoices WHERE id = pg_temp.id('inv2')),
  jsonb_build_object('name', 'WEG Lindenstr. 5', 'street', 'Postfach 12', 'postal_code', '01001', 'city', 'Dresden',
    'country_code', 'DE', 'customer_no', 'K-2', 'vat_id', 'DE123456789', 'invoice_email', 'rechnung@hv-nord.de',
    'is_private', false, 'billing_override', true,
    'property', jsonb_build_object('name', 'Objekt Linden', 'street', 'Lindenstr. 5', 'postal_code', '01099', 'city', 'Dresden')),
  'a property with a billing address: the buyer is the billing address');

-- copy_invoice -----------------------------------------------------------------------------------
SELECT set_config('il.copy1', werkbank.copy_invoice(pg_temp.id('inv1'))::text, true);
SELECT results_eq(
  $$SELECT type, status, order_id, cancels_invoice_id, subject, invoice_no, seller_snapshot
    FROM werkbank.invoices WHERE id = pg_temp.id('copy1')$$,
  $$VALUES ('invoice'::text, 'draft'::text, '33333333-0000-4000-a000-0000000000c1'::uuid, NULL::uuid, 'Bad'::text, NULL::text, NULL::jsonb)$$,
  'a copy of the cancelled original keeps the done order without an active invoice');
SELECT is((SELECT count(*)::int FROM werkbank.document_items WHERE invoice_id = pg_temp.id('copy1')), 3,
  'the copy carries the items');
SELECT set_config('il.copy2', werkbank.copy_invoice(pg_temp.id('inv2'))::text, true);
SELECT results_eq(
  $$SELECT type, status, order_id, customer_id, property_id FROM werkbank.invoices WHERE id = pg_temp.id('copy2')$$,
  $$VALUES ('invoice'::text, 'draft'::text, NULL::uuid, 'cccccccc-0000-4000-c000-0000000000c2'::uuid,
      'dddddddd-0000-4000-d000-0000000000c2'::uuid)$$,
  'a copy of an issued invoice drops the order');
SELECT lives_ok(format($$DELETE FROM werkbank.invoices WHERE id = '%s'$$, pg_temp.id('copy2')),
  'a draft invoice can be deleted');
RESET ROLE;

-- Number range guard ------------------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000c1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$UPDATE werkbank.number_ranges SET prefix = 'R-'
  WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000c1' AND key = 'invoice'$$,
  '55000', 'number_range_locked', 'the invoice prefix is locked after the first issue');
SELECT throws_ok($$UPDATE werkbank.number_ranges SET padding = 6
  WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000c1' AND key = 'invoice'$$,
  '55000', 'number_range_locked', 'the invoice padding is locked after the first issue');
SELECT throws_ok($$UPDATE werkbank.number_ranges SET next_value = 1
  WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000c1' AND key = 'invoice'$$,
  '55000', 'number_range_locked', 'the invoice counter never decreases');
SELECT throws_ok($$UPDATE werkbank.number_ranges SET next_value = 100
  WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000c1' AND key = 'invoice'$$,
  '55000', 'number_range_locked', 'the invoice counter cannot be raised after the first issue');
SELECT lives_ok($$UPDATE werkbank.number_ranges SET prefix = 'AN-'
  WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000c1' AND key = 'quote'$$,
  'other ranges are not guarded');
RESET ROLE;
SELECT throws_ok($$DELETE FROM werkbank.number_ranges WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000c1' AND key = 'invoice'$$,
  '55000', 'number_range_locked', 'the invoice range cannot be deleted after the first issue');
INSERT INTO werkbank.number_ranges (org_id, key, prefix, next_value, padding)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000c2', 'invoice', 'RE-', 5, 4);
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000c4');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$UPDATE werkbank.number_ranges SET prefix = 'R-', padding = 5
  WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000c2' AND key = 'invoice'$$,
  'without an issued invoice the prefix and padding may change');
SELECT lives_ok($$UPDATE werkbank.number_ranges SET next_value = 50
  WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000c2' AND key = 'invoice'$$,
  'without an issued invoice the counter may be raised');
SELECT throws_ok($$UPDATE werkbank.number_ranges SET next_value = 49
  WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000c2' AND key = 'invoice'$$,
  '55000', 'number_range_locked', 'the invoice counter never decreases, even without an issued invoice');

-- 42501: admin of another org ----------------------------------------------------------------------
SELECT throws_ok($$SELECT werkbank.create_invoice_from_order('33333333-0000-4000-a000-0000000000c3')$$,
  '42501', NULL, 'admin of org B cannot create an invoice for org A');
SELECT throws_ok(format($$SELECT werkbank.finalize_invoice('%s')$$, pg_temp.id('copy1')),
  '42501', NULL, 'admin of org B cannot finalize an invoice of org A');
SELECT throws_ok(format($$SELECT werkbank.cancel_invoice('%s')$$, pg_temp.id('inv2')),
  '42501', NULL, 'admin of org B cannot cancel an invoice of org A');
SELECT throws_ok(format($$SELECT werkbank.copy_invoice('%s')$$, pg_temp.id('inv2')),
  '42501', NULL, 'admin of org B cannot copy an invoice of org A');
RESET ROLE;

-- 42501: technician of the org -------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000c3');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT werkbank.create_invoice_from_order('33333333-0000-4000-a000-0000000000c3')$$,
  '42501', NULL, 'a technician cannot create an invoice');
SELECT throws_ok(format($$SELECT werkbank.finalize_invoice('%s')$$, pg_temp.id('copy1')),
  '42501', NULL, 'a technician cannot finalize an invoice');
SELECT throws_ok(format($$SELECT werkbank.cancel_invoice('%s')$$, pg_temp.id('inv2')),
  '42501', NULL, 'a technician cannot cancel an invoice');
SELECT throws_ok(format($$SELECT werkbank.copy_invoice('%s')$$, pg_temp.id('inv2')),
  '42501', NULL, 'a technician cannot copy an invoice');
RESET ROLE;

-- Grants -----------------------------------------------------------------------------------------
SELECT ok(NOT has_function_privilege('anon', 'werkbank.finalize_invoice(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'werkbank.finalize_invoice(uuid)', 'EXECUTE'),
  'finalize_invoice is executable by authenticated only');

-- Deleting the org still removes issued invoices and the guarded range.
SELECT lives_ok($$DELETE FROM public.organizations WHERE id = 'bbbbbbbb-0000-4000-b000-0000000000c1'$$,
  'an org with issued invoices can be deleted');
SELECT is((SELECT count(*)::int FROM werkbank.invoices WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000c1'), 0,
  'the org delete removed its invoices');

SELECT * FROM finish();
ROLLBACK;
