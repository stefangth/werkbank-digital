-- Werkbank Teil 3 polish: artist check as the caller, org-bound catalog references, FK indexes,
-- revise_quote validity, the item bump of quotes.updated_at, asset bucket limits, and the RLS
-- paths the earlier files did not cover.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(57);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000a1','authenticated','authenticated','tp-admin-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000a2','authenticated','authenticated','tp-producer-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000a3','authenticated','authenticated','tp-tech-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000a4','authenticated','authenticated','tp-admin-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000a1','TP Org A','tp-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000a2','TP Org B','tp-org-b','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000a1','aaaaaaaa-0000-4000-a000-0000000000a1','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000000a1','aaaaaaaa-0000-4000-a000-0000000000a2','producer'),
  ('bbbbbbbb-0000-4000-b000-0000000000a1','aaaaaaaa-0000-4000-a000-0000000000a3','artist'),
  ('bbbbbbbb-0000-4000-b000-0000000000a2','aaaaaaaa-0000-4000-a000-0000000000a4','admin');
INSERT INTO public.artists (id, org_id, name) VALUES
  ('99999999-0000-4000-9000-0000000000a1','bbbbbbbb-0000-4000-b000-0000000000a1','Tech A'),
  ('99999999-0000-4000-9000-0000000000a2','bbbbbbbb-0000-4000-b000-0000000000a2','Tech B');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, last_name, street, postal_code, city) VALUES
  ('cccccccc-0000-4000-c000-0000000000a1','bbbbbbbb-0000-4000-b000-0000000000a1','K-1','private','Eins','Weg 1','01067','Dresden'),
  ('cccccccc-0000-4000-c000-0000000000a2','bbbbbbbb-0000-4000-b000-0000000000a2','K-1','private','Zwei','Weg 2','01067','Dresden');
INSERT INTO werkbank.catalog_items (id, org_id, name, unit_code, labour_price, material_price) VALUES
  ('77777777-0000-4000-a000-0000000000a1','bbbbbbbb-0000-4000-b000-0000000000a1','Rohr A','HUR',10,5),
  ('77777777-0000-4000-a000-0000000000a2','bbbbbbbb-0000-4000-b000-0000000000a2','Rohr B','HUR',10,5);
INSERT INTO werkbank.company_profiles (org_id, company_name, street, postal_code, city, quote_validity_days) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000a1','Firma A','Weg 1','01067','Dresden',14);
-- Quotes: S sent (past its date, one catalog item), R rejected, F sent (future date), B sent in org B
-- (past, no profile), D draft. Orders: O open, P in progress, X to be done.
INSERT INTO werkbank.quotes (id, org_id, quote_no, version, customer_id, valid_until, status, sent_at) VALUES
  ('11111111-0000-4000-a000-0000000000a1','bbbbbbbb-0000-4000-b000-0000000000a1','A-0001',1,'cccccccc-0000-4000-c000-0000000000a1',
   (now() at time zone 'Europe/Berlin')::date - 5,'sent',now()),
  ('11111111-0000-4000-a000-0000000000a2','bbbbbbbb-0000-4000-b000-0000000000a1','A-0002',1,'cccccccc-0000-4000-c000-0000000000a1',
   (now() at time zone 'Europe/Berlin')::date + 3,'rejected',now()),
  ('11111111-0000-4000-a000-0000000000a3','bbbbbbbb-0000-4000-b000-0000000000a1','A-0003',1,'cccccccc-0000-4000-c000-0000000000a1',
   (now() at time zone 'Europe/Berlin')::date + 9,'sent',now()),
  ('11111111-0000-4000-a000-0000000000a4','bbbbbbbb-0000-4000-b000-0000000000a2','A-0001',1,'cccccccc-0000-4000-c000-0000000000a2',
   (now() at time zone 'Europe/Berlin')::date - 1,'sent',now()),
  ('11111111-0000-4000-a000-0000000000a5','bbbbbbbb-0000-4000-b000-0000000000a1','A-0004',1,'cccccccc-0000-4000-c000-0000000000a1',
   (now() at time zone 'Europe/Berlin')::date + 30,'draft',null);
INSERT INTO werkbank.document_items (id, org_id, quote_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate, catalog_item_id) VALUES
  ('22222222-0000-4000-a000-0000000000a1','bbbbbbbb-0000-4000-b000-0000000000a1','11111111-0000-4000-a000-0000000000a1',0,'item','Rohr',1,'HUR',10,5,19,'77777777-0000-4000-a000-0000000000a1'),
  ('22222222-0000-4000-a000-0000000000a2','bbbbbbbb-0000-4000-b000-0000000000a1','11111111-0000-4000-a000-0000000000a5',0,'item','Rohr',1,'HUR',10,5,19,'77777777-0000-4000-a000-0000000000a1');
INSERT INTO werkbank.orders (id, org_id, order_no, customer_id, status) VALUES
  ('33333333-0000-4000-a000-0000000000a1','bbbbbbbb-0000-4000-b000-0000000000a1','AU-0001','cccccccc-0000-4000-c000-0000000000a1','open'),
  ('33333333-0000-4000-a000-0000000000a2','bbbbbbbb-0000-4000-b000-0000000000a1','AU-0002','cccccccc-0000-4000-c000-0000000000a1','in_progress'),
  ('33333333-0000-4000-a000-0000000000a3','bbbbbbbb-0000-4000-b000-0000000000a1','AU-0003','cccccccc-0000-4000-c000-0000000000a1','in_progress');
INSERT INTO werkbank.document_items (org_id, order_id, sort_order, kind, name) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000a1','33333333-0000-4000-a000-0000000000a1',0,'title','Bad');
INSERT INTO werkbank.quote_acceptances (org_id, quote_id, decision, signer_name, document_sha256) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000a1','11111111-0000-4000-a000-0000000000a2','rejected','Kunde','abc');
-- Old timestamps so a bump to now() is visible (replica mode skips the updated_at trigger).
UPDATE werkbank.quotes SET updated_at = '2000-01-01' WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000a1';
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.row_count(_sql text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE _sql;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.row_count(text) TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.id(_key text) RETURNS uuid LANGUAGE sql AS $$
  SELECT nullif(current_setting('tp.' || _key, true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;

-- 1. check_artist_org runs as the caller ----------------------------------------------
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'werkbank.check_artist_org()'::regprocedure), false,
  'check_artist_org is SECURITY INVOKER');
SELECT is((SELECT proconfig FROM pg_proc WHERE oid = 'werkbank.check_artist_org()'::regprocedure), ARRAY['search_path=""'],
  'check_artist_org keeps an empty search_path');
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a4');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO werkbank.order_technicians (org_id, order_id, artist_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000a1','33333333-0000-4000-a000-0000000000a1','99999999-0000-4000-9000-0000000000a1')$$,
  '23514', 'artist_org_mismatch', 'a non-member gets the same answer for an artist of the org ...');
SELECT throws_ok($$INSERT INTO werkbank.order_technicians (org_id, order_id, artist_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000a1','33333333-0000-4000-a000-0000000000a1','99999999-0000-4000-9000-0000000000a2')$$,
  '23514', 'artist_org_mismatch', '... and for an artist of another org, so membership does not leak');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a2');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO werkbank.order_technicians (org_id, order_id, artist_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000a1','33333333-0000-4000-a000-0000000000a1','99999999-0000-4000-9000-0000000000a1')$$,
  'producer assigns an artist of the own org');
SELECT throws_ok($$INSERT INTO werkbank.order_technicians (org_id, order_id, artist_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000a1','33333333-0000-4000-a000-0000000000a2','99999999-0000-4000-9000-0000000000a2')$$,
  '23514', 'artist_org_mismatch', 'producer cannot assign an artist of another org');

-- 2. catalog references stay inside the org -------------------------------------------
SELECT throws_ok($$INSERT INTO werkbank.document_items (org_id, quote_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate, catalog_item_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000a1','11111111-0000-4000-a000-0000000000a5',1,'item','Fremd',1,'HUR',1,1,19,'77777777-0000-4000-a000-0000000000a2')$$,
  '23503', NULL, 'an item cannot reference a catalog item of another org');
RESET ROLE;
SELECT fk_ok('werkbank', 'document_items', ARRAY['org_id', 'catalog_item_id'], 'werkbank', 'catalog_items', ARRAY['org_id', 'id'],
  'document_items references catalog_items over (org_id, id)');
SELECT is((SELECT confdeltype::text || array_length(confdelsetcols, 1)::text FROM pg_constraint
           WHERE conrelid = 'werkbank.document_items'::regclass AND contype = 'f'
             AND confrelid = 'werkbank.catalog_items'::regclass), 'n1',
  'the catalog FK sets only catalog_item_id null on delete');
SELECT is((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'werkbank.document_items'::regclass AND contype = 'f'
           AND confrelid = 'werkbank.catalog_items'::regclass), 1, 'the old single-column catalog FK is gone');

-- 3. FK indexes -----------------------------------------------------------------------
SELECT has_index('werkbank', 'document_items', 'document_items_source_item_id_idx', ARRAY['source_item_id'], 'index on document_items.source_item_id');
SELECT has_index('werkbank', 'document_items', 'document_items_catalog_item_id_idx', ARRAY['catalog_item_id'], 'index on document_items.catalog_item_id');
SELECT has_index('werkbank', 'quotes', 'quotes_superseded_by_idx', ARRAY['superseded_by'], 'index on quotes.superseded_by');
SELECT has_index('werkbank', 'quotes', 'quotes_property_id_idx', ARRAY['property_id'], 'index on quotes.property_id');
SELECT has_index('werkbank', 'quotes', 'quotes_contact_id_idx', ARRAY['contact_id'], 'index on quotes.contact_id');
SELECT has_index('werkbank', 'orders', 'orders_property_id_idx', ARRAY['property_id'], 'index on orders.property_id');
SELECT has_index('werkbank', 'orders', 'orders_contact_id_idx', ARRAY['contact_id'], 'index on orders.contact_id');

-- 6. item edits bump the draft quote's updated_at -------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a2');
SET LOCAL ROLE authenticated;
INSERT INTO werkbank.document_items (id, org_id, quote_id, sort_order, kind, description)
  VALUES ('22222222-0000-4000-a000-0000000000a9','bbbbbbbb-0000-4000-b000-0000000000a1','11111111-0000-4000-a000-0000000000a5',1,'text','Hinweis');
RESET ROLE;
SELECT is((SELECT updated_at FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000a5'), now(),
  'an item insert bumps the draft quote updated_at');
SET LOCAL session_replication_role = replica;
UPDATE werkbank.quotes SET updated_at = '2000-01-01' WHERE id = '11111111-0000-4000-a000-0000000000a5';
SET LOCAL session_replication_role = DEFAULT;
SET LOCAL ROLE authenticated;
UPDATE werkbank.document_items SET description = 'Neu' WHERE id = '22222222-0000-4000-a000-0000000000a9';
RESET ROLE;
SELECT is((SELECT updated_at FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000a5'), now(),
  'an item update bumps the draft quote updated_at');
SET LOCAL session_replication_role = replica;
UPDATE werkbank.quotes SET updated_at = '2000-01-01' WHERE id = '11111111-0000-4000-a000-0000000000a5';
SET LOCAL session_replication_role = DEFAULT;
SET LOCAL ROLE authenticated;
DELETE FROM werkbank.document_items WHERE id = '22222222-0000-4000-a000-0000000000a9';
RESET ROLE;
SELECT is((SELECT updated_at FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000a5'), now(),
  'an item delete bumps the draft quote updated_at');

-- 2 + 6. a catalog delete clears the reference on draft and locked quotes alike; the locked one
-- keeps its updated_at.
DELETE FROM werkbank.catalog_items WHERE id = '77777777-0000-4000-a000-0000000000a1';
SELECT is((SELECT count(*)::int FROM werkbank.document_items
           WHERE id IN ('22222222-0000-4000-a000-0000000000a1','22222222-0000-4000-a000-0000000000a2') AND catalog_item_id IS NULL), 2,
  'a catalog delete nulls the reference on a draft and on a sent quote');
SELECT is((SELECT updated_at FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000a1'), '2000-01-01'::timestamptz,
  'the set-null on a sent quote item does not touch the quote');

-- 4. revise_quote ---------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a4');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT werkbank.revise_quote('11111111-0000-4000-a000-0000000000a1')$$, '42501', 'not allowed',
  'admin of another org cannot revise');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a2');
SET LOCAL ROLE authenticated;
SELECT set_config('tp.rev_s', werkbank.revise_quote('11111111-0000-4000-a000-0000000000a1')::text, true);
SELECT is((SELECT valid_until FROM werkbank.quotes WHERE id = pg_temp.id('rev_s')),
  (now() at time zone 'Europe/Berlin')::date + 14,
  'a revision of an expired quote is valid from Berlin today plus the profile validity');
SELECT set_config('tp.rev_f', werkbank.revise_quote('11111111-0000-4000-a000-0000000000a3')::text, true);
SELECT is((SELECT valid_until FROM werkbank.quotes WHERE id = pg_temp.id('rev_f')),
  (now() at time zone 'Europe/Berlin')::date + 9, 'a revision of a quote still valid keeps its date');
SELECT set_config('tp.rev_r', werkbank.revise_quote('11111111-0000-4000-a000-0000000000a2')::text, true);
SELECT results_eq($$SELECT status, superseded_by, superseded_from_status FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000a2'$$,
  $$VALUES ('superseded'::text, pg_temp.id('rev_r'), 'rejected'::text)$$, 'a rejected quote can be revised');
SELECT results_eq($$SELECT version, status FROM werkbank.quotes WHERE id = pg_temp.id('rev_r')$$,
  $$VALUES (2, 'draft'::text)$$, 'the revision of a rejected quote is draft version 2');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a4');
SET LOCAL ROLE authenticated;
SELECT set_config('tp.rev_b', werkbank.revise_quote('11111111-0000-4000-a000-0000000000a4')::text, true);
SELECT is((SELECT valid_until FROM werkbank.quotes WHERE id = pg_temp.id('rev_b')),
  (now() at time zone 'Europe/Berlin')::date + 30, 'without a company profile the revision gets 30 days');
RESET ROLE;

-- 7. asset bucket limits --------------------------------------------------------------
SELECT results_eq($$SELECT file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'werkbank-assets'$$,
  $$VALUES (1048576::bigint, ARRAY['image/png','image/jpeg']::text[])$$, 'werkbank-assets takes PNG and JPEG up to 1 MB');

-- 10. coverage gaps -------------------------------------------------------------------
-- Admin positive path on quotes and orders.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO werkbank.quotes (id, org_id, customer_id, valid_until)
  VALUES ('11111111-0000-4000-a000-0000000000b1','bbbbbbbb-0000-4000-b000-0000000000a1','cccccccc-0000-4000-c000-0000000000a1', current_date + 30)$$,
  'admin inserts a quote');
SELECT is(pg_temp.row_count($q$UPDATE werkbank.quotes SET subject = 'Admin' WHERE id = '11111111-0000-4000-a000-0000000000b1'$q$), 1,
  'admin updates a draft quote');
SELECT is((SELECT count(*)::int FROM werkbank.quotes WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000a1'), 8, 'admin reads the org quotes');
SELECT is(pg_temp.row_count($q$DELETE FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000b1'$q$), 1,
  'admin deletes a draft quote');
SELECT lives_ok($$INSERT INTO werkbank.orders (id, org_id, customer_id)
  VALUES ('33333333-0000-4000-a000-0000000000b1','bbbbbbbb-0000-4000-b000-0000000000a1','cccccccc-0000-4000-c000-0000000000a1')$$,
  'admin inserts an order');
SELECT is(pg_temp.row_count($q$UPDATE werkbank.orders SET subject = 'Admin' WHERE id = '33333333-0000-4000-a000-0000000000b1'$q$), 1,
  'admin updates an order');
SELECT is((SELECT count(*)::int FROM werkbank.orders), 4, 'admin reads the org orders');
SELECT is(pg_temp.row_count($q$DELETE FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000000b1'$q$), 1,
  'admin deletes an open order');
SELECT throws_ok($$DELETE FROM werkbank.company_profiles$$, '42501', NULL, 'admin cannot delete the company profile');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a2');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$DELETE FROM werkbank.company_profiles$$, '42501', NULL, 'producer cannot delete the company profile');
SELECT is((SELECT count(*)::int FROM werkbank.quote_acceptances), 1, 'producer reads the quote acceptance');
RESET ROLE;

-- quote_acceptances: the method check constraint (run as superuser, past RLS); invisible to a
-- technician and another org.
SELECT throws_ok($$INSERT INTO werkbank.quote_acceptances (org_id, quote_id, decision, signer_name, document_sha256)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000a1','11111111-0000-4000-a000-0000000000a3','accepted','Kunde','abc')$$,
  '23514', NULL, 'the method check constraint rejects an acceptance without a method (as superuser, not RLS)');
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a3');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.quote_acceptances), 0, 'a technician sees no quote acceptances');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a4');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.quote_acceptances), 0, 'another org sees no quote acceptances');
RESET ROLE;

-- Orders: no technician on a done order; an open delete cascades, an in-progress delete is a no-op.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a2');
SET LOCAL ROLE authenticated;
UPDATE werkbank.orders SET status = 'done' WHERE id = '33333333-0000-4000-a000-0000000000a3';
SELECT throws_ok($$INSERT INTO werkbank.order_technicians (org_id, order_id, artist_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000a1','33333333-0000-4000-a000-0000000000a3','99999999-0000-4000-9000-0000000000a1')$$,
  '55000', 'order_locked', 'no technician can be added to a done order');
SELECT is(pg_temp.row_count($q$DELETE FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000000a2'$q$), 0,
  'producer deletes no in-progress order');
SELECT is(pg_temp.row_count($q$DELETE FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000000a1'$q$), 1,
  'producer deletes an open order');
RESET ROLE;
SELECT is((SELECT count(*)::int FROM werkbank.document_items WHERE order_id = '33333333-0000-4000-a000-0000000000a1'), 0,
  'deleting an open order removes its items');
SELECT is((SELECT count(*)::int FROM werkbank.order_technicians WHERE order_id = '33333333-0000-4000-a000-0000000000a1'), 0,
  'deleting an open order removes its technicians');
SELECT is((SELECT count(*)::int FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000000a2'), 1,
  'the in-progress order is still there');

-- Assets: admin updates and deletes, producer neither.
SET LOCAL storage.allow_delete_query = 'true';
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
INSERT INTO storage.objects (bucket_id, name) VALUES ('werkbank-assets','bbbbbbbb-0000-4000-b000-0000000000a1/logo.png');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a2');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.row_count($q$UPDATE storage.objects SET metadata = '{"x":1}' WHERE bucket_id = 'werkbank-assets'$q$), 0,
  'producer cannot update an asset');
SELECT is(pg_temp.row_count($q$DELETE FROM storage.objects WHERE bucket_id = 'werkbank-assets'$q$), 0,
  'producer cannot delete an asset');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a4');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.row_count($q$UPDATE storage.objects SET metadata = '{"x":1}' WHERE bucket_id = 'werkbank-assets'$q$), 0,
  'admin of another org cannot update an asset');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000a1');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.row_count($q$UPDATE storage.objects SET metadata = '{"x":1}' WHERE bucket_id = 'werkbank-assets'
  AND name = 'bbbbbbbb-0000-4000-b000-0000000000a1/logo.png'$q$), 1, 'admin updates an asset');
SELECT throws_ok($$UPDATE storage.objects SET name = 'bbbbbbbb-0000-4000-b000-0000000000a2/logo.png' WHERE bucket_id = 'werkbank-assets'$$,
  '42501', NULL, 'admin cannot move an asset into another org');
SELECT is(pg_temp.row_count($q$DELETE FROM storage.objects WHERE bucket_id = 'werkbank-assets'
  AND name = 'bbbbbbbb-0000-4000-b000-0000000000a1/logo.png'$q$), 1, 'admin deletes an asset');
RESET ROLE;

-- 6. The touch trigger does not get in the way of cascades: a draft quote with items and a
-- whole org delete cleanly.
SELECT lives_ok($$DELETE FROM werkbank.quotes WHERE id = pg_temp.id('rev_r')$$, 'a draft revision with items deletes');
DELETE FROM public.artists WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000a1';
SELECT lives_ok($$DELETE FROM public.organizations WHERE id = 'bbbbbbbb-0000-4000-b000-0000000000a1'$$,
  'an org with draft and sent quotes, items and orders deletes');

SELECT * FROM finish();
ROLLBACK;
