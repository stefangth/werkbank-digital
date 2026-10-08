-- Werkbank Teil 5 (R2): lock triggers on invoice_entries and dunning_notices, the helper
-- invoice_open_amount and the RPCs record_invoice_entry, reverse_invoice_entry,
-- transfer_invoice_entry, create_dunning_notice, set_dunning_hold, clear_dunning_hold.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(139);

-- Berlin dates must not depend on the session time zone.
SET LOCAL timezone = 'UTC';

CREATE OR REPLACE FUNCTION pg_temp.berlin_today() RETURNS date LANGUAGE sql AS $$
  SELECT (now() AT TIME ZONE 'Europe/Berlin')::date
$$;
GRANT EXECUTE ON FUNCTION pg_temp.berlin_today() TO PUBLIC;

-- Fixtures. Every invoice has one item of 1000 net at 19 %, so its gross is 1190.
--   e1 inv1   issued, customer 1, due yesterday   payments, reversal, transfer source
--   e2 inv2   issued, customer 1, due yesterday   write-off
--   e3 inv3   issued, customer 1, due yesterday   overpayment, refund
--   e4 inv4   issued, customer 2                  transfer target of another customer
--   e5 inv5   issued, customer 1                  valid transfer target
--   e6 draft  draft, customer 1
--   e7 invC   cancelled, customer 1, payments 500 and 300 (fixture entries f7, f8)
--   e8 invS   cancellation of invC, issued
--   e9 invT   issued, due Berlin today
--   ea invN   issued, due yesterday               notices
--   eb invM   issued, due yesterday               notice under a time zone ahead of Berlin
--   ec invM2  issued, due yesterday               notice under a time zone behind Berlin
--   ed invB   org B, issued, due yesterday, payment fb
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000e2','authenticated','authenticated','ol-producer-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000e3','authenticated','authenticated','ol-tech-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000e4','authenticated','authenticated','ol-admin-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000e1','OL Org A','ol-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000e2','OL Org B','ol-org-b','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000e1','aaaaaaaa-0000-4000-a000-0000000000e2','producer'),
  ('bbbbbbbb-0000-4000-b000-0000000000e1','aaaaaaaa-0000-4000-a000-0000000000e3','artist'),
  ('bbbbbbbb-0000-4000-b000-0000000000e2','aaaaaaaa-0000-4000-a000-0000000000e4','admin');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, last_name, street, postal_code, city) VALUES
  ('cccccccc-0000-4000-c000-0000000000e1','bbbbbbbb-0000-4000-b000-0000000000e1','K-1','private','Eins','Weg 1','01067','Dresden'),
  ('cccccccc-0000-4000-c000-0000000000e2','bbbbbbbb-0000-4000-b000-0000000000e1','K-2','private','Zwei','Weg 2','01067','Dresden'),
  ('cccccccc-0000-4000-c000-0000000000e3','bbbbbbbb-0000-4000-b000-0000000000e2','K-1','private','Drei','Weg 3','01067','Dresden');
INSERT INTO werkbank.invoices (id, org_id, type, cancels_invoice_id, customer_id, invoice_no, status, issue_date, due_date, seller_snapshot, buyer_snapshot) VALUES
  ('66666666-0000-4000-a000-0000000000e1','bbbbbbbb-0000-4000-b000-0000000000e1','invoice',NULL,'cccccccc-0000-4000-c000-0000000000e1','RE-0001','issued',pg_temp.berlin_today() - 15,pg_temp.berlin_today() - 1,'{}','{}'),
  ('66666666-0000-4000-a000-0000000000e2','bbbbbbbb-0000-4000-b000-0000000000e1','invoice',NULL,'cccccccc-0000-4000-c000-0000000000e1','RE-0002','issued',pg_temp.berlin_today() - 15,pg_temp.berlin_today() - 1,'{}','{}'),
  ('66666666-0000-4000-a000-0000000000e3','bbbbbbbb-0000-4000-b000-0000000000e1','invoice',NULL,'cccccccc-0000-4000-c000-0000000000e1','RE-0003','issued',pg_temp.berlin_today() - 15,pg_temp.berlin_today() - 1,'{}','{}'),
  ('66666666-0000-4000-a000-0000000000e4','bbbbbbbb-0000-4000-b000-0000000000e1','invoice',NULL,'cccccccc-0000-4000-c000-0000000000e2','RE-0004','issued',pg_temp.berlin_today() - 15,pg_temp.berlin_today() - 1,'{}','{}'),
  ('66666666-0000-4000-a000-0000000000e5','bbbbbbbb-0000-4000-b000-0000000000e1','invoice',NULL,'cccccccc-0000-4000-c000-0000000000e1','RE-0005','issued',pg_temp.berlin_today() - 15,pg_temp.berlin_today() - 1,'{}','{}'),
  ('66666666-0000-4000-a000-0000000000e6','bbbbbbbb-0000-4000-b000-0000000000e1','invoice',NULL,'cccccccc-0000-4000-c000-0000000000e1',NULL,'draft',NULL,NULL,NULL,NULL),
  ('66666666-0000-4000-a000-0000000000e7','bbbbbbbb-0000-4000-b000-0000000000e1','invoice',NULL,'cccccccc-0000-4000-c000-0000000000e1','RE-0007','cancelled',pg_temp.berlin_today() - 15,pg_temp.berlin_today() - 1,'{}','{}'),
  ('66666666-0000-4000-a000-0000000000e8','bbbbbbbb-0000-4000-b000-0000000000e1','cancellation','66666666-0000-4000-a000-0000000000e7','cccccccc-0000-4000-c000-0000000000e1','RE-0008','issued',pg_temp.berlin_today() - 5,pg_temp.berlin_today() - 1,'{}','{}'),
  ('66666666-0000-4000-a000-0000000000e9','bbbbbbbb-0000-4000-b000-0000000000e1','invoice',NULL,'cccccccc-0000-4000-c000-0000000000e1','RE-0009','issued',pg_temp.berlin_today() - 14,pg_temp.berlin_today(),'{}','{}'),
  ('66666666-0000-4000-a000-0000000000ea','bbbbbbbb-0000-4000-b000-0000000000e1','invoice',NULL,'cccccccc-0000-4000-c000-0000000000e1','RE-0010','issued',pg_temp.berlin_today() - 15,pg_temp.berlin_today() - 1,'{}','{}'),
  ('66666666-0000-4000-a000-0000000000eb','bbbbbbbb-0000-4000-b000-0000000000e1','invoice',NULL,'cccccccc-0000-4000-c000-0000000000e1','RE-0011','issued',pg_temp.berlin_today() - 15,pg_temp.berlin_today() - 1,'{}','{}'),
  ('66666666-0000-4000-a000-0000000000ec','bbbbbbbb-0000-4000-b000-0000000000e1','invoice',NULL,'cccccccc-0000-4000-c000-0000000000e1','RE-0012','issued',pg_temp.berlin_today() - 15,pg_temp.berlin_today() - 1,'{}','{}'),
  ('66666666-0000-4000-a000-0000000000ed','bbbbbbbb-0000-4000-b000-0000000000e2','invoice',NULL,'cccccccc-0000-4000-c000-0000000000e3','RE-0001','issued',pg_temp.berlin_today() - 15,pg_temp.berlin_today() - 1,'{}','{}');
INSERT INTO werkbank.document_items (org_id, invoice_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate)
SELECT i.org_id, i.id, 0, 'item', 'Arbeit', 1, 'HUR', 1000, 0, 19 FROM werkbank.invoices i
WHERE i.id::text LIKE '66666666-0000-4000-a000-0000000000e_';
INSERT INTO werkbank.invoice_entries (id, org_id, invoice_id, kind, amount, booked_on, created_by) VALUES
  ('77777777-0000-4000-a000-0000000000f7','bbbbbbbb-0000-4000-b000-0000000000e1','66666666-0000-4000-a000-0000000000e7','payment',500,pg_temp.berlin_today() - 3,'aaaaaaaa-0000-4000-a000-0000000000e2'),
  ('77777777-0000-4000-a000-0000000000f8','bbbbbbbb-0000-4000-b000-0000000000e1','66666666-0000-4000-a000-0000000000e7','payment',300,pg_temp.berlin_today() - 2,'aaaaaaaa-0000-4000-a000-0000000000e2'),
  ('77777777-0000-4000-a000-0000000000fb','bbbbbbbb-0000-4000-b000-0000000000e2','66666666-0000-4000-a000-0000000000ed','payment',100,pg_temp.berlin_today() - 3,'aaaaaaaa-0000-4000-a000-0000000000e4');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.id(_key text) RETURNS uuid LANGUAGE sql AS $$
  SELECT nullif(current_setting('ol.' || _key, true), '')::uuid
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

-- Open amount read as the owner (independent of the caller's RLS).
CREATE OR REPLACE FUNCTION pg_temp.open(_inv text) RETURNS numeric LANGUAGE sql SECURITY DEFINER AS $$
  SELECT werkbank.invoice_open_amount(('66666666-0000-4000-a000-0000000000' || _inv)::uuid)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.open(text) TO PUBLIC;

-- Function shape ---------------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM pg_proc p
  WHERE p.pronamespace = 'werkbank'::regnamespace AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']
    AND p.proname IN ('record_invoice_entry','reverse_invoice_entry','transfer_invoice_entry',
                      'create_dunning_notice','set_dunning_hold','clear_dunning_hold')), 6,
  'the six RPCs are SECURITY DEFINER with an empty search_path');
SELECT ok((SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE')) FROM pg_proc p
  WHERE p.pronamespace = 'werkbank'::regnamespace
    AND p.proname IN ('record_invoice_entry','reverse_invoice_entry','transfer_invoice_entry',
                      'create_dunning_notice','set_dunning_hold','clear_dunning_hold','invoice_open_amount')),
  'authenticated may execute the RPCs and invoice_open_amount');
SELECT is((SELECT prosecdef FROM pg_proc WHERE oid = 'werkbank.invoice_open_amount(uuid)'::regprocedure), false,
  'invoice_open_amount is SECURITY INVOKER (RLS of the caller applies)');
SELECT ok(NOT has_function_privilege('authenticated', 'werkbank.authorize_invoice(uuid, uuid)', 'EXECUTE'),
  'authenticated may not call the internal authorize_invoice helper');

-- Direct writes ------------------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO werkbank.invoice_entries (org_id, invoice_id, kind, amount, booked_on, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','66666666-0000-4000-a000-0000000000e1','payment',5,'2026-10-01','aaaaaaaa-0000-4000-a000-0000000000e2')$$,
  '42501', NULL, 'producer cannot insert an entry directly');
SELECT throws_ok($$INSERT INTO werkbank.dunning_notices (org_id, invoice_id, stage, notice_date, payment_deadline, invoice_gross, paid_amount, open_amount, delivery, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','66666666-0000-4000-a000-0000000000e1',1,'2026-10-08','2026-10-15',1190,0,1190,'email','aaaaaaaa-0000-4000-a000-0000000000e2')$$,
  '42501', NULL, 'producer cannot insert a notice directly');
SELECT throws_ok($$INSERT INTO werkbank.dunning_holds (org_id, invoice_id, reason, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','66666666-0000-4000-a000-0000000000e1','x','aaaaaaaa-0000-4000-a000-0000000000e2')$$,
  '42501', NULL, 'producer cannot insert a hold directly');
SELECT throws_ok($$UPDATE werkbank.invoice_entries SET amount = 1 WHERE id = '77777777-0000-4000-a000-0000000000f7'$$,
  '42501', NULL, 'producer cannot update an entry directly');
RESET ROLE;

-- Entry lock (owner and service role) ----------------------------------------------------------
SELECT throws_ok($$UPDATE werkbank.invoice_entries SET amount = 1 WHERE id = '77777777-0000-4000-a000-0000000000f7'$$,
  '55000', 'entries_locked', 'owner cannot change the amount of an entry');
SELECT throws_ok($$UPDATE werkbank.invoice_entries SET reversed_at = now(), reversed_by = 'aaaaaaaa-0000-4000-a000-0000000000e2',
  reversal_reason = 'x' WHERE id = '77777777-0000-4000-a000-0000000000f7'$$,
  '55000', 'entries_locked', 'owner cannot reverse an entry without the reversal setting');
SELECT throws_ok($$DELETE FROM werkbank.invoice_entries WHERE id = '77777777-0000-4000-a000-0000000000f7'$$,
  '55000', 'entries_locked', 'owner cannot delete an entry');
SET LOCAL werkbank.entry_reversal = 'on';
SELECT throws_ok($$UPDATE werkbank.invoice_entries SET amount = 1, reversed_at = now(), reversed_by = 'aaaaaaaa-0000-4000-a000-0000000000e2',
  reversal_reason = 'x' WHERE id = '77777777-0000-4000-a000-0000000000f7'$$,
  '55000', 'entries_locked', 'with the setting, only the reversal columns may change');
SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE werkbank.invoice_entries SET reversed_at = now(), reversed_by = 'aaaaaaaa-0000-4000-a000-0000000000e2',
  reversal_reason = 'x' WHERE id = '77777777-0000-4000-a000-0000000000f7'$$,
  '55000', 'entries_locked', 'the service role cannot reverse, even with the setting');
SELECT throws_ok($$INSERT INTO werkbank.invoice_entries (org_id, invoice_id, kind, amount, booked_on, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','66666666-0000-4000-a000-0000000000e1','payment',5,'2026-10-01','aaaaaaaa-0000-4000-a000-0000000000e2')$$,
  '55000', 'entries_locked', 'the service role cannot insert an entry');
SELECT throws_ok($$DELETE FROM werkbank.invoice_entries WHERE id = '77777777-0000-4000-a000-0000000000f7'$$,
  '55000', 'entries_locked', 'the service role cannot delete an entry');
RESET ROLE;
SET LOCAL werkbank.entry_reversal = '';

-- Payments ---------------------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;
SELECT is(werkbank.invoice_open_amount('66666666-0000-4000-a000-0000000000e1'), 1190.00,
  'invoice_open_amount of an unpaid issued invoice is its gross');
SELECT set_config('ol.p1', werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e1', 'payment', 100,
  pg_temp.berlin_today(), 'Teilzahlung')::text, true);
SELECT is(pg_temp.open('e1'), 1090.00, 'a payment of 100 leaves 1090 open');
SELECT results_eq(
  $$SELECT org_id, invoice_id, kind, amount, booked_on, note, write_off_reason, transferred_from, created_by, reversed_at
    FROM werkbank.invoice_entries WHERE id = pg_temp.id('p1')$$,
  $$VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1'::uuid, '66666666-0000-4000-a000-0000000000e1'::uuid, 'payment'::text,
    100.00::numeric(12,2), pg_temp.berlin_today(), 'Teilzahlung'::text, NULL::text, NULL::uuid,
    'aaaaaaaa-0000-4000-a000-0000000000e2'::uuid, NULL::timestamptz)$$,
  'the payment row carries org, invoice, amount, date, note and the caller');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e6', 'payment', 100, pg_temp.berlin_today())$$,
  '22023', 'not_payable', 'a payment on a draft fails');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e8', 'payment', 100, pg_temp.berlin_today())$$,
  '22023', 'not_payable', 'a payment on a cancellation invoice fails');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e7', 'payment', 100, pg_temp.berlin_today())$$,
  '22023', 'not_payable', 'a payment on a cancelled invoice fails');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e1', 'payment', 100, pg_temp.berlin_today() + 1)$$,
  '22023', 'future_booking_date', 'a booking date after Berlin today fails');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e1', 'payment', 0, pg_temp.berlin_today())$$,
  '23514', NULL, 'a zero amount fails');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e1', 'payment', 10.005, pg_temp.berlin_today())$$,
  '22023', 'invalid_amount', 'more than two decimals fail instead of being rounded');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e1', 'credit', 10, pg_temp.berlin_today())$$,
  '22023', 'invalid_entry_kind', 'an unknown kind fails');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e1', 'payment', 10, pg_temp.berlin_today(), NULL, 'skonto')$$,
  '23514', NULL, 'a payment with a write-off reason fails');

-- Reversal -----------------------------------------------------------------------------------
SELECT lives_ok($$SELECT werkbank.reverse_invoice_entry(pg_temp.id('p1'), 'Falsche Rechnung')$$, 'a payment can be reversed');
SELECT results_eq(
  $$SELECT reversed_at, reversed_by, reversal_reason FROM werkbank.invoice_entries WHERE id = pg_temp.id('p1')$$,
  $$VALUES (now(), 'aaaaaaaa-0000-4000-a000-0000000000e2'::uuid, 'Falsche Rechnung'::text)$$,
  'reversal sets the three columns');
SELECT is(pg_temp.open('e1'), 1190.00, 'after the reversal the open amount rises again');
SELECT throws_ok($$SELECT werkbank.reverse_invoice_entry(pg_temp.id('p1'), 'Nochmal')$$,
  '22023', 'already_reversed', 'a second reversal fails');
SELECT throws_ok($$SELECT werkbank.reverse_invoice_entry('77777777-0000-4000-a000-0000000000f7', '  ')$$,
  '23514', NULL, 'a blank reversal reason fails');
SELECT is(current_setting('werkbank.entry_reversal', true), 'off', 'the RPC switches the reversal setting off again');
SELECT throws_ok($$SELECT werkbank.reverse_invoice_entry('99999999-0000-4000-a000-000000000000', 'x')$$,
  '42501', 'not allowed', 'an unknown entry fails like a foreign one');

-- Write-off ------------------------------------------------------------------------------------
SELECT lives_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e2', 'payment', 100, pg_temp.berlin_today())$$,
  'a payment of 100 on inv2');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e2', 'write_off', 1000, pg_temp.berlin_today(), NULL, 'skonto')$$,
  '22023', 'open_amount_changed', 'a write-off with a stale amount fails');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e2', 'write_off', 1090, pg_temp.berlin_today())$$,
  '23514', NULL, 'a write-off without reason fails');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e2', 'write_off', 1090, pg_temp.berlin_today(), NULL, 'other')$$,
  '23514', NULL, 'a write-off for another reason needs a note');
SELECT set_config('ol.w1', werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e2', 'write_off', 1090,
  pg_temp.berlin_today(), NULL, 'skonto')::text, true);
SELECT is(pg_temp.open('e2'), 0.00, 'a write-off of the open amount leaves 0 open');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e2', 'write_off', 1090, pg_temp.berlin_today(), NULL, 'skonto')$$,
  '22023', 'nothing_open', 'a second write-off (double submit) fails with nothing_open');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e2', 'write_off', 0.01, pg_temp.berlin_today(), NULL, 'skonto')$$,
  '22023', 'nothing_open', 'nothing_open is checked before the amount');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e7', 'write_off', 100, pg_temp.berlin_today(), NULL, 'skonto')$$,
  '22023', 'not_payable', 'a write-off on a cancelled invoice fails');
SELECT is(pg_temp.err_detail($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000e2', 'email', pg_temp.berlin_today() + 7)$$),
  'nothing_open', 'a settled invoice cannot be dunned');
SELECT lives_ok($$SELECT werkbank.reverse_invoice_entry(pg_temp.id('w1'), 'Skonto nicht berechtigt')$$, 'a write-off can be reversed');
SELECT is(pg_temp.open('e2'), 1090.00, 'after reversing the write-off 1090 are open again');

-- Overpayment and refunds ------------------------------------------------------------------------
SELECT lives_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e3', 'payment', 1300, pg_temp.berlin_today())$$,
  'a payment above the open amount is allowed');
SELECT is(pg_temp.open('e3'), -110.00, 'the overpayment is a credit of 110');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e3', 'refund', 120, pg_temp.berlin_today())$$,
  '22023', 'refund_exceeds_credit', 'a refund above the credit fails');
SELECT lives_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e3', 'refund', 110, pg_temp.berlin_today())$$,
  'a refund of the credit is allowed');
SELECT is(pg_temp.open('e3'), 0.00, 'after the refund nothing is open');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e3', 'refund', 0.01, pg_temp.berlin_today())$$,
  '22023', 'refund_exceeds_credit', 'no refund without credit');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e3', 'write_off', 0.01, pg_temp.berlin_today(), NULL, 'goodwill')$$,
  '22023', 'nothing_open', 'no write-off on a settled invoice');

-- Cancelled invoice with a payment: claim 0, credit 500.
SELECT is(pg_temp.open('e7'), -800.00, 'a cancelled invoice has claim 0, its payments are a credit');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e7', 'refund', 800.01, pg_temp.berlin_today())$$,
  '22023', 'refund_exceeds_credit', 'a refund on a cancelled invoice is capped by the paid amount');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e8', 'refund', 1, pg_temp.berlin_today())$$,
  '22023', 'not_payable', 'a refund on a cancellation invoice fails');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e6', 'refund', 1, pg_temp.berlin_today())$$,
  '22023', 'not_payable', 'a refund on a draft fails');
SELECT is(pg_temp.err_detail($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000e7', 'email', pg_temp.berlin_today() + 7)$$),
  'not_issued,nothing_open', 'a cancelled invoice cannot be dunned (blockers in order)');
SELECT lives_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e7', 'refund', 500, pg_temp.berlin_today())$$,
  'a refund on a cancelled invoice up to the paid amount is allowed');
SELECT is(pg_temp.open('e7'), -300.00, 'the refund reduces the credit');

-- Transfer -----------------------------------------------------------------------------------------
SELECT set_config('ol.t1', werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e1', 'payment', 200,
  pg_temp.berlin_today() - 2, 'Ueberweisung')::text, true);
SELECT is(pg_temp.open('e1'), 990.00, 'inv1 has 990 open before the transfer');
SELECT throws_ok($$SELECT werkbank.transfer_invoice_entry(pg_temp.id('t1'), '66666666-0000-4000-a000-0000000000e4', 'Falsch zugeordnet')$$,
  '22023', 'transfer_target_invalid', 'transfer to an invoice of another customer fails');
SELECT throws_ok($$SELECT werkbank.transfer_invoice_entry(pg_temp.id('t1'), '66666666-0000-4000-a000-0000000000ed', 'Falsch zugeordnet')$$,
  '22023', 'transfer_target_invalid', 'transfer to an invoice of another org fails');
SELECT throws_ok($$SELECT werkbank.transfer_invoice_entry(pg_temp.id('t1'), '66666666-0000-4000-a000-0000000000e1', 'Falsch zugeordnet')$$,
  '22023', 'transfer_target_invalid', 'transfer to the same invoice fails');
SELECT throws_ok($$SELECT werkbank.transfer_invoice_entry(pg_temp.id('t1'), '66666666-0000-4000-a000-0000000000e6', 'Falsch zugeordnet')$$,
  '22023', 'transfer_target_invalid', 'transfer to a draft fails');
SELECT throws_ok($$SELECT werkbank.transfer_invoice_entry(pg_temp.id('t1'), '66666666-0000-4000-a000-0000000000e7', 'Falsch zugeordnet')$$,
  '22023', 'transfer_target_invalid', 'transfer to a cancelled invoice fails');
SELECT throws_ok($$SELECT werkbank.transfer_invoice_entry(pg_temp.id('t1'), '66666666-0000-4000-a000-0000000000e8', 'Falsch zugeordnet')$$,
  '22023', 'transfer_target_invalid', 'transfer to a cancellation invoice fails');
SELECT is((SELECT reversed_at FROM werkbank.invoice_entries WHERE id = pg_temp.id('t1')), NULL,
  'failed transfers leave the source untouched');

-- One statement: when the insert of the new entry fails, the reversal of the source is rolled back.
RESET ROLE;
CREATE FUNCTION pg_temp.fail_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF new.transferred_from IS NOT NULL THEN
    RAISE EXCEPTION 'target locked' USING errcode = '55P03';
  END IF;
  RETURN new;
END $$;
CREATE TRIGGER ol_fail_transfer BEFORE INSERT ON werkbank.invoice_entries
  FOR EACH ROW EXECUTE FUNCTION pg_temp.fail_transfer();
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT werkbank.transfer_invoice_entry(pg_temp.id('t1'), '66666666-0000-4000-a000-0000000000e5', 'Falsch zugeordnet')$$,
  '55P03', 'target locked', 'a transfer whose new entry fails raises');
SELECT is((SELECT reversed_at FROM werkbank.invoice_entries WHERE id = pg_temp.id('t1')), NULL,
  'the failed transfer did not reverse the source');
SELECT is((SELECT count(*)::int FROM werkbank.invoice_entries WHERE invoice_id = '66666666-0000-4000-a000-0000000000e5'), 0,
  'the failed transfer did not book on the target');
RESET ROLE;
DROP TRIGGER ol_fail_transfer ON werkbank.invoice_entries;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;

SELECT set_config('ol.t2', werkbank.transfer_invoice_entry(pg_temp.id('t1'), '66666666-0000-4000-a000-0000000000e5', 'Falsch zugeordnet')::text, true);
SELECT results_eq(
  $$SELECT invoice_id, kind, amount, booked_on, transferred_from, note, created_by, reversed_at
    FROM werkbank.invoice_entries WHERE id = pg_temp.id('t2')$$,
  $$VALUES ('66666666-0000-4000-a000-0000000000e5'::uuid, 'payment'::text, 200.00::numeric(12,2), pg_temp.berlin_today() - 2,
    pg_temp.id('t1'), 'Ueberweisung'::text, 'aaaaaaaa-0000-4000-a000-0000000000e2'::uuid, NULL::timestamptz)$$,
  'the transfer books the same amount and date on the target with transferred_from');
SELECT results_eq(
  $$SELECT reversed_at IS NOT NULL, reversal_reason FROM werkbank.invoice_entries WHERE id = pg_temp.id('t1')$$,
  $$VALUES (true, 'Falsch zugeordnet'::text)$$,
  'the transfer reverses the source with the reason');
SELECT is(pg_temp.open('e1'), 1190.00, 'the source invoice is open again');
SELECT is(pg_temp.open('e5'), 990.00, 'the target invoice received the payment');
SELECT throws_ok($$SELECT werkbank.transfer_invoice_entry(pg_temp.id('t1'), '66666666-0000-4000-a000-0000000000e5', 'Nochmal')$$,
  '22023', 'already_reversed', 'a reversed entry cannot be transferred');
SELECT throws_ok($$SELECT werkbank.transfer_invoice_entry(pg_temp.id('w1'), '66666666-0000-4000-a000-0000000000e5', 'x')$$,
  '22023', 'already_reversed', 'the reversed write-off cannot be transferred either');
SELECT set_config('ol.r3', (SELECT id::text FROM werkbank.invoice_entries
  WHERE invoice_id = '66666666-0000-4000-a000-0000000000e3' AND kind = 'refund'), true);
SELECT throws_ok($$SELECT werkbank.transfer_invoice_entry(pg_temp.id('r3'), '66666666-0000-4000-a000-0000000000e5', 'x')$$,
  '22023', 'transfer_target_invalid', 'only payments can be transferred');
-- A payment on a cancelled invoice (credit) can move to the corrected invoice.
SELECT lives_ok($$SELECT werkbank.transfer_invoice_entry('77777777-0000-4000-a000-0000000000f8', '66666666-0000-4000-a000-0000000000e5', 'Neue Rechnung')$$,
  'a payment on a cancelled invoice can be transferred to an issued one');
SELECT is(pg_temp.open('e7'), 0.00, 'the cancelled invoice is settled after refund and transfer');

-- Dunning notices ----------------------------------------------------------------------------------
SELECT throws_ok($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000e9', 'email', pg_temp.berlin_today() + 7)$$,
  '22023', 'dunning_not_allowed', 'an invoice due Berlin today cannot be dunned');
SELECT is(pg_temp.err_detail($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000e9', 'email', pg_temp.berlin_today() + 7)$$),
  'not_overdue', 'the blocker is not_overdue');
SELECT is(pg_temp.err_detail($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000e6', 'email', pg_temp.berlin_today() + 7)$$),
  'not_issued,not_overdue', 'a draft is not issued and has no due date');

SELECT lives_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000ea', 'payment', 100, pg_temp.berlin_today())$$,
  'a payment of 100 on invN');
SELECT lives_ok($$SELECT werkbank.set_dunning_hold('66666666-0000-4000-a000-0000000000ea', 'Klaerung mit HV')$$, 'a hold without end');
SELECT results_eq(
  $$SELECT org_id, reason, until, created_by FROM werkbank.dunning_holds WHERE invoice_id = '66666666-0000-4000-a000-0000000000ea'$$,
  $$VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1'::uuid, 'Klaerung mit HV'::text, NULL::date, 'aaaaaaaa-0000-4000-a000-0000000000e2'::uuid)$$,
  'the hold row');
SELECT is(pg_temp.err_detail($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000ea', 'email', pg_temp.berlin_today() + 7)$$),
  'on_hold', 'an active hold blocks');
SELECT lives_ok($$SELECT werkbank.set_dunning_hold('66666666-0000-4000-a000-0000000000ea', 'Bis heute', pg_temp.berlin_today())$$,
  'the hold is updated (upsert)');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_holds WHERE invoice_id = '66666666-0000-4000-a000-0000000000ea'), 1,
  'still one hold row');
SELECT is(pg_temp.err_detail($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000ea', 'email', pg_temp.berlin_today() + 7)$$),
  'on_hold', 'a hold until Berlin today still blocks');
SELECT throws_ok($$SELECT werkbank.set_dunning_hold('66666666-0000-4000-a000-0000000000ea', ' ')$$,
  '23514', NULL, 'a hold needs a reason');
SELECT lives_ok($$SELECT werkbank.set_dunning_hold('66666666-0000-4000-a000-0000000000ea', 'Abgelaufen', pg_temp.berlin_today() - 1)$$,
  'the hold ends yesterday');

SELECT set_config('ol.n1', (werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000ea', 'email', pg_temp.berlin_today() + 7)).id::text, true);
SELECT results_eq(
  $$SELECT org_id, stage, notice_date, payment_deadline, invoice_gross, paid_amount, open_amount, delivery, pdf_path, sent_at, created_by
    FROM werkbank.dunning_notices WHERE id = pg_temp.id('n1')$$,
  $$VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1'::uuid, 1::smallint, pg_temp.berlin_today(), pg_temp.berlin_today() + 7,
    1190.00::numeric(12,2), 100.00::numeric(12,2), 1090.00::numeric(12,2), 'email'::text, NULL::text, NULL::timestamptz,
    'aaaaaaaa-0000-4000-a000-0000000000e2'::uuid)$$,
  'an expired hold passes; stage 1 snapshots gross 1190, paid 100, open 1090 and the Berlin date');
SELECT is(pg_temp.err_detail($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000ea', 'email', pg_temp.berlin_today() + 7)$$),
  'previous_stage_open', 'stage 2 needs the file of stage 1');
SELECT throws_ok($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000ea', 'email', pg_temp.berlin_today() - 1)$$,
  '22023', 'dunning_not_allowed', 'blockers are checked before the deadline');
RESET ROLE;

-- Notice lock --------------------------------------------------------------------------------------
SET LOCAL ROLE service_role;
SELECT lives_ok($$UPDATE werkbank.dunning_notices SET pdf_path = 'x/dunning/n1.pdf', pdf_sha256 = 'abc' WHERE id = pg_temp.id('n1')$$,
  'the service role stores the file once');
SELECT throws_ok($$UPDATE werkbank.dunning_notices SET pdf_path = 'x/dunning/other.pdf' WHERE id = pg_temp.id('n1')$$,
  '55000', 'dunning_locked', 'the file cannot be replaced');
SELECT throws_ok($$UPDATE werkbank.dunning_notices SET open_amount = 1 WHERE id = pg_temp.id('n1')$$,
  '55000', 'dunning_locked', 'the service role cannot change the amounts');
SELECT throws_ok($$DELETE FROM werkbank.dunning_notices WHERE id = pg_temp.id('n1')$$,
  '55000', 'dunning_locked', 'the service role cannot delete a notice');
SELECT throws_ok($$INSERT INTO werkbank.dunning_notices (org_id, invoice_id, stage, notice_date, payment_deadline, invoice_gross, paid_amount, open_amount, delivery, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','66666666-0000-4000-a000-0000000000e1',1,'2026-10-08','2026-10-15',1190,0,1190,'email','aaaaaaaa-0000-4000-a000-0000000000e2')$$,
  '55000', 'dunning_locked', 'the service role cannot insert a notice');
RESET ROLE;
SELECT throws_ok($$DELETE FROM werkbank.dunning_notices WHERE id = pg_temp.id('n1')$$,
  '55000', 'dunning_locked', 'the owner cannot delete a notice');

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.err_detail($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000ea', 'print', pg_temp.berlin_today() + 7)$$),
  'previous_stage_open', 'an emailed stage 1 also needs sent_at');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT lives_ok($$UPDATE werkbank.dunning_notices SET sent_at = now(), sent_to = ARRAY['hv@example.com'] WHERE id = pg_temp.id('n1')$$,
  'the service role records the send');
SELECT lives_ok($$UPDATE werkbank.dunning_notices SET sent_at = now() + interval '1 minute', sent_to = ARRAY['b@example.com'] WHERE id = pg_temp.id('n1')$$,
  'the service role records a second send');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;
SELECT set_config('ol.n2', (werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000ea', 'print', pg_temp.berlin_today() + 7)).id::text, true);
SELECT results_eq($$SELECT stage, delivery FROM werkbank.dunning_notices WHERE id = pg_temp.id('n2')$$,
  $$VALUES (2::smallint, 'print'::text)$$, 'stage 2 follows a stored and sent stage 1');
SELECT is(pg_temp.err_detail($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000ea', 'print', pg_temp.berlin_today() + 7)$$),
  'previous_stage_open', 'stage 3 needs the file of stage 2');
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE werkbank.dunning_notices SET pdf_path = 'x/dunning/n2.pdf', pdf_sha256 = 'def' WHERE id = pg_temp.id('n2');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;
SELECT set_config('ol.n3', (werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000ea', 'print', pg_temp.berlin_today() + 7)).id::text, true);
SELECT is((SELECT stage FROM werkbank.dunning_notices WHERE id = pg_temp.id('n3')), 3::smallint,
  'a printed stage 2 needs only its file');
SELECT is(pg_temp.err_detail($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000ea', 'print', pg_temp.berlin_today() + 7)$$),
  'previous_stage_open,max_stage', 'after stage 3 without file: both blockers');
RESET ROLE;
SET LOCAL ROLE service_role;
UPDATE werkbank.dunning_notices SET pdf_path = 'x/dunning/n3.pdf', pdf_sha256 = 'ghi' WHERE id = pg_temp.id('n3');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.err_detail($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000ea', 'print', pg_temp.berlin_today() + 7)$$),
  'max_stage', 'there is no stage 4');
SELECT lives_ok($$SELECT werkbank.set_dunning_hold('66666666-0000-4000-a000-0000000000ea', 'Ratenzahlung')$$, 'hold again');
SELECT is(pg_temp.err_detail($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000ea', 'print', pg_temp.berlin_today() + 7)$$),
  'on_hold,max_stage', 'blockers are listed in the fixed order');
SELECT lives_ok($$SELECT werkbank.clear_dunning_hold('66666666-0000-4000-a000-0000000000ea')$$, 'the hold is lifted');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_holds WHERE invoice_id = '66666666-0000-4000-a000-0000000000ea'), 0,
  'lifting deletes the hold row');
SELECT lives_ok($$SELECT werkbank.clear_dunning_hold('66666666-0000-4000-a000-0000000000ea')$$, 'lifting twice is harmless');
RESET ROLE;

-- Berlin midnight: the RPCs use the Berlin date, not the session date. At any moment at least one of
-- these two zones (UTC+14 and UTC-12) is on another calendar day than Berlin.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;
SET LOCAL timezone = 'Pacific/Kiritimati';
SELECT lives_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e5', 'payment', 1, pg_temp.berlin_today())$$,
  'UTC+14 session: Berlin today is accepted as booking date');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e5', 'payment', 1, pg_temp.berlin_today() + 1)$$,
  '22023', 'future_booking_date', 'UTC+14 session: Berlin tomorrow is rejected');
SELECT is(pg_temp.err_detail($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000e9', 'email', pg_temp.berlin_today() + 7)$$),
  'not_overdue', 'UTC+14 session: due Berlin today is not overdue');
SELECT is((werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000eb', 'email', pg_temp.berlin_today() + 7)).notice_date,
  pg_temp.berlin_today(), 'UTC+14 session: due Berlin yesterday is dunned with the Berlin notice date');
SET LOCAL timezone = 'Etc/GMT+12';
SELECT lives_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e5', 'payment', 1, pg_temp.berlin_today())$$,
  'UTC-12 session: Berlin today is accepted as booking date');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e5', 'payment', 1, pg_temp.berlin_today() + 1)$$,
  '22023', 'future_booking_date', 'UTC-12 session: Berlin tomorrow is rejected');
SELECT is(pg_temp.err_detail($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000e9', 'email', pg_temp.berlin_today() + 7)$$),
  'not_overdue', 'UTC-12 session: due Berlin today is not overdue');
SELECT is((werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000ec', 'email', pg_temp.berlin_today() + 7)).notice_date,
  pg_temp.berlin_today(), 'UTC-12 session: due Berlin yesterday is dunned with the Berlin notice date');
SET LOCAL timezone = 'UTC';

-- Roles: a producer of org A on org B, a technician of org A -------------------------------------------
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000ed', 'payment', 1, pg_temp.berlin_today())$$,
  '42501', 'not allowed', 'producer A cannot book on an invoice of org B');
SELECT throws_ok($$SELECT werkbank.reverse_invoice_entry('77777777-0000-4000-a000-0000000000fb', 'x')$$,
  '42501', 'not allowed', 'producer A cannot reverse an entry of org B');
SELECT throws_ok($$SELECT werkbank.transfer_invoice_entry('77777777-0000-4000-a000-0000000000fb', '66666666-0000-4000-a000-0000000000e5', 'x')$$,
  '42501', 'not allowed', 'producer A cannot transfer an entry of org B');
SELECT throws_ok($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000ed', 'email', pg_temp.berlin_today() + 7)$$,
  '42501', 'not allowed', 'producer A cannot dun an invoice of org B');
SELECT throws_ok($$SELECT werkbank.set_dunning_hold('66666666-0000-4000-a000-0000000000ed', 'x')$$,
  '42501', 'not allowed', 'producer A cannot hold an invoice of org B');
SELECT throws_ok($$SELECT werkbank.clear_dunning_hold('66666666-0000-4000-a000-0000000000ed')$$,
  '42501', 'not allowed', 'producer A cannot lift a hold of org B');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('99999999-0000-4000-a000-000000000000', 'payment', 1, pg_temp.berlin_today())$$,
  '42501', 'not allowed', 'an unknown invoice fails like a foreign one');
SELECT is(werkbank.invoice_open_amount('66666666-0000-4000-a000-0000000000ed'), NULL,
  'invoice_open_amount does not reveal an invoice of org B');
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e4');
SET LOCAL ROLE authenticated;
SELECT is(werkbank.invoice_open_amount('66666666-0000-4000-a000-0000000000ed'), 1090.00,
  'admin B reads the open amount of its own invoice');
SELECT throws_ok($$SELECT werkbank.transfer_invoice_entry('77777777-0000-4000-a000-0000000000fb', '66666666-0000-4000-a000-0000000000e5', 'x')$$,
  '22023', 'transfer_target_invalid', 'admin B cannot transfer into org A');
RESET ROLE;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e3');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e1', 'payment', 1, pg_temp.berlin_today())$$,
  '42501', 'not allowed', 'a technician cannot book a payment');
SELECT throws_ok($$SELECT werkbank.reverse_invoice_entry(pg_temp.id('t2'), 'x')$$,
  '42501', 'not allowed', 'a technician cannot reverse');
SELECT throws_ok($$SELECT werkbank.transfer_invoice_entry(pg_temp.id('t2'), '66666666-0000-4000-a000-0000000000e1', 'x')$$,
  '42501', 'not allowed', 'a technician cannot transfer');
SELECT throws_ok($$SELECT werkbank.create_dunning_notice('66666666-0000-4000-a000-0000000000e1', 'email', pg_temp.berlin_today() + 7)$$,
  '42501', 'not allowed', 'a technician cannot dun');
SELECT throws_ok($$SELECT werkbank.set_dunning_hold('66666666-0000-4000-a000-0000000000e1', 'x')$$,
  '42501', 'not allowed', 'a technician cannot hold');
SELECT throws_ok($$SELECT werkbank.clear_dunning_hold('66666666-0000-4000-a000-0000000000e1')$$,
  '42501', 'not allowed', 'a technician cannot lift a hold');
RESET ROLE;

SELECT set_config('request.jwt.claims', '', true);
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT werkbank.record_invoice_entry('66666666-0000-4000-a000-0000000000e1', 'payment', 1, '2026-10-01')$$,
  '42501', NULL, 'anon cannot call the RPCs');
RESET ROLE;

-- An org delete cascades through the locked rows. --------------------------------------------------
SELECT lives_ok($$DELETE FROM public.organizations WHERE id = 'bbbbbbbb-0000-4000-b000-0000000000e1'$$,
  'an org with entries, notices and holds can be deleted');
SELECT is((SELECT count(*)::int FROM werkbank.invoice_entries WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000e1')
  + (SELECT count(*)::int FROM werkbank.dunning_notices WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000e1'), 0,
  'its entries and notices are gone');

SELECT * FROM finish();
ROLLBACK;
