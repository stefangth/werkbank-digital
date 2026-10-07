-- Werkbank Teil 3 (R2): quote and order locks, transitions, numbering and the three RPCs.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(82);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000e1','authenticated','authenticated','ql-admin-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000e2','authenticated','authenticated','ql-producer-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000e3','authenticated','authenticated','ql-tech-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000e4','authenticated','authenticated','ql-admin-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000e1','QL Org A','ql-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000e2','QL Org B','ql-org-b','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000e1','aaaaaaaa-0000-4000-a000-0000000000e1','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000000e1','aaaaaaaa-0000-4000-a000-0000000000e2','producer'),
  ('bbbbbbbb-0000-4000-b000-0000000000e1','aaaaaaaa-0000-4000-a000-0000000000e3','artist'),
  ('bbbbbbbb-0000-4000-b000-0000000000e2','aaaaaaaa-0000-4000-a000-0000000000e4','admin');
INSERT INTO public.artists (id, org_id, name) VALUES
  ('99999999-0000-4000-9000-0000000000e1','bbbbbbbb-0000-4000-b000-0000000000e1','Tech A');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, last_name, street, postal_code, city) VALUES
  ('cccccccc-0000-4000-c000-0000000000e1','bbbbbbbb-0000-4000-b000-0000000000e1','K-1','private','Eins','Weg 1','01067','Dresden'),
  ('cccccccc-0000-4000-c000-0000000000e2','bbbbbbbb-0000-4000-b000-0000000000e1','K-2','private','Zwei','Weg 2','01067','Dresden');
INSERT INTO werkbank.properties (id, org_id, customer_id, name, street, postal_code, city) VALUES
  ('dddddddd-0000-4000-d000-0000000000e1','bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1','Objekt 1','Weg 1','01067','Dresden'),
  ('dddddddd-0000-4000-d000-0000000000e2','bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e2','Objekt 2','Weg 2','01067','Dresden');
INSERT INTO werkbank.contacts (id, org_id, customer_id, last_name) VALUES
  ('eeeeeeee-0000-4000-e000-0000000000e1','bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1','Kontakt'),
  ('eeeeeeee-0000-4000-e000-0000000000e2','bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1','Weg');
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

-- Ids captured from the RPCs live in transaction-local settings.
CREATE OR REPLACE FUNCTION pg_temp.id(_key text) RETURNS uuid LANGUAGE sql AS $$
  SELECT nullif(current_setting('ql.' || _key, true), '')::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.id(text) TO PUBLIC;

-- Numbering ---------------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;
INSERT INTO werkbank.quotes (id, org_id, customer_id, property_id, contact_id, subject, valid_until)
  VALUES ('11111111-0000-4000-a000-0000000000e1','bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1',
          'dddddddd-0000-4000-d000-0000000000e1','eeeeeeee-0000-4000-e000-0000000000e1','Bad', current_date + 30);
INSERT INTO werkbank.quotes (id, org_id, customer_id, property_id, contact_id, subject, valid_until)
  VALUES ('11111111-0000-4000-a000-0000000000e2','bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1',
          'dddddddd-0000-4000-d000-0000000000e1','eeeeeeee-0000-4000-e000-0000000000e1','Küche', current_date + 30);
SELECT is((SELECT quote_no FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000e1'), 'A-0001', 'first quote gets A-0001');
SELECT is((SELECT quote_no FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000e2'), 'A-0002', 'second quote gets A-0002');
INSERT INTO werkbank.quotes (org_id, quote_no, customer_id, valid_until)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','A-0003','cccccccc-0000-4000-c000-0000000000e1', current_date + 30);
INSERT INTO werkbank.quotes (id, org_id, customer_id, contact_id, valid_until)
  VALUES ('11111111-0000-4000-a000-0000000000e3','bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1',
          'eeeeeeee-0000-4000-e000-0000000000e2', current_date + 30);
SELECT is((SELECT quote_no FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000e3'), 'A-0004',
  'a quote number taken by hand is skipped');
INSERT INTO werkbank.orders (id, org_id, customer_id)
  VALUES ('33333333-0000-4000-a000-0000000000e1','bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1');
SELECT is((SELECT order_no FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000000e1'), 'AU-0001', 'first order gets AU-0001');
INSERT INTO werkbank.orders (org_id, order_no, customer_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','AU-0002','cccccccc-0000-4000-c000-0000000000e1');
INSERT INTO werkbank.orders (id, org_id, customer_id)
  VALUES ('33333333-0000-4000-a000-0000000000e2','bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1');
SELECT is((SELECT order_no FROM werkbank.orders WHERE id = '33333333-0000-4000-a000-0000000000e2'), 'AU-0003',
  'an order number taken by hand is skipped');
SELECT results_eq(
  $$SELECT key, prefix, padding FROM werkbank.number_ranges
    WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000e1' AND key IN ('quote','order') ORDER BY key$$,
  $$VALUES ('order'::text, 'AU-'::text, 4), ('quote'::text, 'A-'::text, 4)$$,
  'quote and order ranges are seeded with prefix and padding 4');

-- Draft quote: content and items are editable.
SELECT lives_ok($$INSERT INTO werkbank.document_items (org_id, quote_id, sort_order, kind, name)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','11111111-0000-4000-a000-0000000000e1',0,'title','Bad')$$,
  'producer adds a title to a draft quote');
SELECT lives_ok($$INSERT INTO werkbank.document_items (id, org_id, quote_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate)
  VALUES ('22222222-0000-4000-a000-0000000000e1','bbbbbbbb-0000-4000-b000-0000000000e1','11111111-0000-4000-a000-0000000000e1',1,'item','Rohr',2,'HUR',10,5,19)$$,
  'producer adds an item to a draft quote');
SELECT lives_ok($$INSERT INTO werkbank.document_items (org_id, quote_id, sort_order, kind, description)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','11111111-0000-4000-a000-0000000000e1',2,'text','Hinweis')$$,
  'producer adds a text to a draft quote');
SELECT is(pg_temp.row_count($q$UPDATE werkbank.quotes SET subject = 'Bad neu' WHERE id = '11111111-0000-4000-a000-0000000000e1'$q$),
  1, 'producer edits the subject of a draft quote');
SELECT throws_ok($$UPDATE werkbank.document_items SET quote_id = '11111111-0000-4000-a000-0000000000e2'
  WHERE id = '22222222-0000-4000-a000-0000000000e1'$$,
  '22023', 'item_reparent', 'an item cannot move to another document');

-- Service-only columns: never writable by authenticated, at any status.
SELECT throws_ok($$UPDATE werkbank.quotes SET access_token_hash = 'x' WHERE id = '11111111-0000-4000-a000-0000000000e2'$$,
  '42501', 'quote_service_only', 'producer cannot write access_token_hash on a draft');
SELECT throws_ok($$UPDATE werkbank.quotes SET pdf_sha256 = 'x' WHERE id = '11111111-0000-4000-a000-0000000000e2'$$,
  '42501', 'quote_service_only', 'producer cannot write pdf_sha256 on a draft');
SELECT throws_ok($$UPDATE werkbank.quotes SET status = 'sent' WHERE id = '11111111-0000-4000-a000-0000000000e2'$$,
  '42501', 'quote_service_only', 'producer cannot send a quote by setting status');
SELECT throws_ok($$INSERT INTO werkbank.quotes (org_id, customer_id, valid_until, status)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1', current_date, 'accepted')$$,
  '42501', 'quote_service_only', 'producer cannot insert a quote that is not a draft');
SELECT throws_ok($$INSERT INTO werkbank.quotes (org_id, customer_id, valid_until, access_token_hash)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1', current_date, 'x')$$,
  '42501', 'quote_service_only', 'producer cannot insert a quote with a token hash');
RESET ROLE;

-- The service role sends quote 1 (status and send columns).
SET LOCAL ROLE service_role;
SELECT is(pg_temp.row_count($q$UPDATE werkbank.quotes SET status = 'sent', sent_at = now(), sent_to = array['k@example.com'],
  pdf_path = 'a.pdf', pdf_sha256 = 'abc', access_token_hash = 'hash-1' WHERE id = '11111111-0000-4000-a000-0000000000e1'$q$),
  1, 'service role sends a quote');
UPDATE werkbank.quotes SET status = 'sent' WHERE id = '11111111-0000-4000-a000-0000000000e3';
SELECT throws_ok($$UPDATE werkbank.quotes SET subject = 'x' WHERE id = '11111111-0000-4000-a000-0000000000e1'$$,
  '55000', 'quote_locked', 'service role cannot edit the content of a sent quote either');
SELECT throws_ok($$UPDATE werkbank.quotes SET status = 'draft' WHERE id = '11111111-0000-4000-a000-0000000000e1'$$,
  '22023', 'invalid_transition', 'sent to draft is not a transition, even for the service role');
RESET ROLE;

-- Producer on the sent quote.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$UPDATE werkbank.quotes SET subject = 'x' WHERE id = '11111111-0000-4000-a000-0000000000e1'$$,
  '55000', 'quote_locked', 'producer cannot edit the subject of a sent quote');
SELECT throws_ok($$UPDATE werkbank.quotes SET discount_percent = 10 WHERE id = '11111111-0000-4000-a000-0000000000e1'$$,
  '55000', 'quote_locked', 'producer cannot change the discount of a sent quote');
SELECT throws_ok($$INSERT INTO werkbank.document_items (org_id, quote_id, sort_order, kind, name)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','11111111-0000-4000-a000-0000000000e1',5,'title','Neu')$$,
  '55000', 'quote_locked', 'producer cannot add an item to a sent quote');
SELECT throws_ok($$UPDATE werkbank.document_items SET name = 'x' WHERE id = '22222222-0000-4000-a000-0000000000e1'$$,
  '55000', 'quote_locked', 'producer cannot edit an item of a sent quote');
SELECT throws_ok($$DELETE FROM werkbank.document_items WHERE id = '22222222-0000-4000-a000-0000000000e1'$$,
  '55000', 'quote_locked', 'producer cannot delete an item of a sent quote');
SELECT is(pg_temp.row_count($q$UPDATE werkbank.quotes SET valid_until = current_date + 60 WHERE id = '11111111-0000-4000-a000-0000000000e1'$q$),
  1, 'producer extends valid_until of a sent quote');
SELECT is(pg_temp.row_count($q$UPDATE werkbank.quotes SET link_revoked_at = now() WHERE id = '11111111-0000-4000-a000-0000000000e1'$q$),
  1, 'producer revokes the link of a sent quote');
SELECT throws_ok($$UPDATE werkbank.quotes SET status = 'accepted' WHERE id = '11111111-0000-4000-a000-0000000000e1'$$,
  '42501', 'quote_service_only', 'producer cannot accept a quote (service role only)');
SELECT throws_ok($$UPDATE werkbank.quotes SET status = 'draft' WHERE id = '11111111-0000-4000-a000-0000000000e1'$$,
  '42501', 'quote_service_only', 'producer cannot set a sent quote back to draft');
SELECT throws_ok($$UPDATE werkbank.quotes SET access_token_hash = 'y' WHERE id = '11111111-0000-4000-a000-0000000000e1'$$,
  '42501', 'quote_service_only', 'producer cannot write access_token_hash on a sent quote');
SELECT throws_ok($$UPDATE werkbank.quotes SET pdf_sha256 = 'y' WHERE id = '11111111-0000-4000-a000-0000000000e1'$$,
  '42501', 'quote_service_only', 'producer cannot write pdf_sha256 on a sent quote');
SELECT is(pg_temp.row_count($q$DELETE FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000e1'$q$),
  0, 'a sent quote cannot be deleted (RLS limits deletes to drafts)');
-- Deleting a contact clears contact_id on a sent quote through the FK action (runs as owner).
SELECT lives_ok($$DELETE FROM werkbank.contacts WHERE id = 'eeeeeeee-0000-4000-e000-0000000000e2'$$,
  'producer deletes a contact used by a sent quote');
RESET ROLE;
SELECT is((SELECT contact_id FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000e3'), NULL::uuid,
  'the FK action cleared contact_id on the sent quote');
SELECT is((SELECT count(*)::int FROM werkbank.document_items WHERE quote_id = '11111111-0000-4000-a000-0000000000e1'),
  3, 'the sent quote still has its three items');

-- revise_quote ------------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;
SELECT set_config('ql.rev', werkbank.revise_quote('11111111-0000-4000-a000-0000000000e1')::text, true);
SELECT isnt(pg_temp.id('rev'), '11111111-0000-4000-a000-0000000000e1'::uuid, 'revise_quote returns a new id');
SELECT results_eq(
  $$SELECT quote_no, version, status, subject, customer_id, property_id FROM werkbank.quotes WHERE id = pg_temp.id('rev')$$,
  $$VALUES ('A-0001'::text, 2, 'draft'::text, 'Bad neu'::text, 'cccccccc-0000-4000-c000-0000000000e1'::uuid, 'dddddddd-0000-4000-d000-0000000000e1'::uuid)$$,
  'the revision keeps the number and header, version 2, draft');
SELECT is((SELECT count(*)::int FROM werkbank.document_items WHERE quote_id = pg_temp.id('rev')), 3, 'the revision copies the items');
SELECT results_eq(
  $$SELECT status, superseded_by, link_revoked_at IS NOT NULL FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000e1'$$,
  $$SELECT 'superseded'::text, pg_temp.id('rev'), true$$,
  'the old version is superseded, points at the revision and its link is revoked');
SELECT throws_ok($$SELECT werkbank.revise_quote('11111111-0000-4000-a000-0000000000e2')$$,
  '22023', 'invalid_transition', 'revise_quote on a draft fails');
SELECT throws_ok($$SELECT werkbank.revise_quote('11111111-0000-4000-a000-0000000000e1')$$,
  '22023', 'invalid_transition', 'revise_quote on a superseded quote fails');
SELECT lives_ok($$UPDATE werkbank.document_items SET name = 'Rohr neu' WHERE quote_id = pg_temp.id('rev') AND kind = 'item'$$,
  'the revision is editable');

-- copy_quote --------------------------------------------------------------------------
SELECT set_config('ql.copy1', werkbank.copy_quote('11111111-0000-4000-a000-0000000000e1')::text, true);
SELECT results_eq(
  $$SELECT version, status, quote_no <> 'A-0001', customer_id, property_id, contact_id, subject FROM werkbank.quotes WHERE id = pg_temp.id('copy1')$$,
  $$VALUES (1, 'draft'::text, true, 'cccccccc-0000-4000-c000-0000000000e1'::uuid, 'dddddddd-0000-4000-d000-0000000000e1'::uuid,
            'eeeeeeee-0000-4000-e000-0000000000e1'::uuid, 'Bad neu'::text)$$,
  'copy_quote creates a version 1 draft with a new number and the same header');
SELECT is((SELECT count(*)::int FROM werkbank.document_items WHERE quote_id = pg_temp.id('copy1')), 3, 'copy_quote copies the items');
SELECT set_config('ql.copy2', werkbank.copy_quote('11111111-0000-4000-a000-0000000000e1', 'cccccccc-0000-4000-c000-0000000000e2')::text, true);
SELECT results_eq(
  $$SELECT customer_id, property_id, contact_id FROM werkbank.quotes WHERE id = pg_temp.id('copy2')$$,
  $$VALUES ('cccccccc-0000-4000-c000-0000000000e2'::uuid, NULL::uuid, NULL::uuid)$$,
  'copy_quote with another customer clears the mismatching property and contact');
SELECT set_config('ql.copy3', werkbank.copy_quote('11111111-0000-4000-a000-0000000000e1', 'cccccccc-0000-4000-c000-0000000000e2', 'dddddddd-0000-4000-d000-0000000000e2')::text, true);
SELECT is((SELECT property_id FROM werkbank.quotes WHERE id = pg_temp.id('copy3')), 'dddddddd-0000-4000-d000-0000000000e2'::uuid,
  'copy_quote takes the given property of the new customer');
SELECT throws_ok($$SELECT werkbank.copy_quote('11111111-0000-4000-a000-0000000000e1', 'cccccccc-0000-4000-c000-0000000000e1', 'dddddddd-0000-4000-d000-0000000000e2')$$,
  '23514', 'property_customer_mismatch', 'copy_quote rejects a property of another customer');
RESET ROLE;

-- create_order_from_quote -------------------------------------------------------------
-- The service role sends and accepts the revision; a copy is only sent; a quote without
-- property is accepted.
SET LOCAL ROLE service_role;
SELECT lives_ok($$UPDATE werkbank.quotes SET status = 'sent' WHERE id = pg_temp.id('rev')$$, 'service role sends the revision');
SELECT lives_ok($$UPDATE werkbank.quotes SET status = 'accepted', accepted_pdf_path = 'b.pdf' WHERE id = pg_temp.id('rev')$$,
  'service role accepts the revision');
SELECT throws_ok($$UPDATE werkbank.quotes SET status = 'sent' WHERE id = pg_temp.id('rev')$$,
  '22023', 'invalid_transition', 'accepted to sent is not a transition');
UPDATE werkbank.quotes SET status = 'sent' WHERE id = pg_temp.id('copy1');
UPDATE werkbank.quotes SET status = 'accepted' WHERE id = '11111111-0000-4000-a000-0000000000e3';
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;
SELECT set_config('ql.order', werkbank.create_order_from_quote(pg_temp.id('rev'))::text, true);
SELECT results_eq(
  $$SELECT quote_id, customer_id, property_id, contact_id, subject, status, order_no FROM werkbank.orders WHERE id = pg_temp.id('order')$$,
  $$SELECT pg_temp.id('rev'), 'cccccccc-0000-4000-c000-0000000000e1'::uuid, 'dddddddd-0000-4000-d000-0000000000e1'::uuid,
           'eeeeeeee-0000-4000-e000-0000000000e1'::uuid, 'Bad neu'::text, 'open'::text, 'AU-0004'::text$$,
  'create_order_from_quote copies the header into an open order with the next number');
SELECT is((SELECT count(*)::int FROM werkbank.document_items WHERE order_id = pg_temp.id('order')), 3, 'the order gets the items');
SELECT is((SELECT count(*)::int FROM werkbank.document_items o
           JOIN werkbank.document_items q ON q.id = o.source_item_id AND q.quote_id = pg_temp.id('rev')
           WHERE o.order_id = pg_temp.id('order') AND o.kind = q.kind AND o.sort_order = q.sort_order), 3,
  'every order item points at its quote item');
SELECT throws_ok($$SELECT werkbank.create_order_from_quote(pg_temp.id('rev'))$$,
  '23505', NULL, 'a second order from the same quote fails');
SELECT throws_ok($$SELECT werkbank.create_order_from_quote(pg_temp.id('copy1'))$$,
  '22023', 'invalid_transition', 'create_order_from_quote on a sent quote fails');
SELECT set_config('ql.order2', werkbank.create_order_from_quote('11111111-0000-4000-a000-0000000000e3')::text, true);
SELECT is((SELECT property_id FROM werkbank.orders WHERE id = pg_temp.id('order2')), NULL::uuid,
  'a quote without property yields an order without property');

-- Order transitions and lock ----------------------------------------------------------
SELECT throws_ok($$UPDATE werkbank.orders SET status = 'done' WHERE id = pg_temp.id('order2')$$,
  '22023', 'invalid_transition', 'open to done is not a transition');
SELECT throws_ok($$INSERT INTO werkbank.orders (org_id, customer_id, status)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000e1','done')$$,
  '22023', 'invalid_transition', 'an order cannot start as done');
SELECT lives_ok($$UPDATE werkbank.orders SET status = 'in_progress' WHERE id = pg_temp.id('order')$$, 'open to in_progress');
SELECT lives_ok($$INSERT INTO werkbank.order_technicians (org_id, order_id, artist_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1', pg_temp.id('order'), '99999999-0000-4000-9000-0000000000e1')$$,
  'a technician is assigned while in progress');
SELECT lives_ok($$UPDATE werkbank.orders SET status = 'done' WHERE id = pg_temp.id('order')$$, 'in_progress to done');
SELECT is((SELECT completed_at IS NOT NULL FROM werkbank.orders WHERE id = pg_temp.id('order')), true, 'done stamps completed_at');
SELECT throws_ok($$UPDATE werkbank.document_items SET name = 'x' WHERE order_id = pg_temp.id('order') AND kind = 'item'$$,
  '55000', 'order_locked', 'an item of a done order cannot be edited');
SELECT throws_ok($$INSERT INTO werkbank.document_items (org_id, order_id, sort_order, kind, name)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1', pg_temp.id('order'), 9, 'title', 'Neu')$$,
  '55000', 'order_locked', 'no item can be added to a done order');
SELECT throws_ok($$UPDATE werkbank.orders SET notes = 'x' WHERE id = pg_temp.id('order')$$,
  '55000', 'order_locked', 'the header of a done order cannot be edited');
SELECT throws_ok($$DELETE FROM werkbank.order_technicians WHERE order_id = pg_temp.id('order')$$,
  '55000', 'order_locked', 'technicians of a done order cannot be removed');
SELECT throws_ok($$UPDATE werkbank.orders SET status = 'cancelled' WHERE id = pg_temp.id('order')$$,
  '22023', 'invalid_transition', 'done to cancelled is not a transition');
SELECT lives_ok($$UPDATE werkbank.orders SET status = 'in_progress' WHERE id = pg_temp.id('order')$$, 'done to in_progress reopens');
SELECT is((SELECT completed_at IS NOT NULL FROM werkbank.orders WHERE id = pg_temp.id('order')), true, 'reopening clears nothing');
SELECT is(pg_temp.row_count($q$UPDATE werkbank.document_items SET name = 'Rohr offen' WHERE order_id = pg_temp.id('order') AND kind = 'item'$q$),
  1, 'a reopened order is editable');
SELECT lives_ok($$UPDATE werkbank.orders SET status = 'cancelled' WHERE id = pg_temp.id('order')$$, 'in_progress to cancelled');
SELECT is((SELECT cancelled_at IS NOT NULL FROM werkbank.orders WHERE id = pg_temp.id('order')), true, 'cancelled stamps cancelled_at');
SELECT throws_ok($$UPDATE werkbank.orders SET status = 'open' WHERE id = pg_temp.id('order')$$,
  '22023', 'invalid_transition', 'cancelled is final');
SELECT throws_ok($$UPDATE werkbank.document_items SET name = 'x' WHERE order_id = pg_temp.id('order') AND kind = 'item'$$,
  '55000', 'order_locked', 'an item of a cancelled order cannot be edited');
RESET ROLE;

-- Authorization -----------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e3');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT werkbank.revise_quote(pg_temp.id('copy1'))$$, '42501', NULL, 'technician cannot revise_quote');
SELECT throws_ok($$SELECT werkbank.copy_quote(pg_temp.id('copy1'))$$, '42501', NULL, 'technician cannot copy_quote');
SELECT throws_ok($$SELECT werkbank.create_order_from_quote('11111111-0000-4000-a000-0000000000e3')$$, '42501', NULL, 'technician cannot create_order_from_quote');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e4');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT werkbank.revise_quote(pg_temp.id('copy1'))$$, '42501', NULL, 'admin of another org cannot revise_quote');
SELECT throws_ok($$SELECT werkbank.copy_quote(pg_temp.id('copy1'))$$, '42501', NULL, 'admin of another org cannot copy_quote');
SELECT throws_ok($$SELECT werkbank.create_order_from_quote('11111111-0000-4000-a000-0000000000e3')$$, '42501', NULL, 'admin of another org cannot create_order_from_quote');
RESET ROLE;
SELECT ok(
  NOT has_function_privilege('anon', 'werkbank.revise_quote(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'werkbank.copy_quote(uuid, uuid, uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'werkbank.create_order_from_quote(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'werkbank.revise_quote(uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'werkbank.copy_quote(uuid, uuid, uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'werkbank.create_order_from_quote(uuid)', 'EXECUTE'),
  'the RPCs are executable by authenticated, not by anon');

-- Cascades still work through the locks (FK actions run as the table owner).
SELECT lives_ok($$DELETE FROM public.artists WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000e1';
  DELETE FROM public.organizations WHERE id = 'bbbbbbbb-0000-4000-b000-0000000000e1'$$,
  'deleting the org removes sent, accepted and cancelled documents');
SELECT is((SELECT count(*)::int FROM werkbank.document_items WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000e1'), 0,
  'org delete removed the items');

SELECT * FROM finish();
ROLLBACK;
