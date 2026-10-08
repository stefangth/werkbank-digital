-- Werkbank Teil 5, final review fixes (ruling R12): write-offs do not count on a cancelled invoice,
-- a transfer from a cancelled invoice is capped at its credit, and a notice's sent_at cannot be
-- cleared once set.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(20);

SET LOCAL timezone = 'UTC';

CREATE OR REPLACE FUNCTION pg_temp.today() RETURNS date LANGUAGE sql AS $$
  SELECT (now() AT TIME ZONE 'Europe/Berlin')::date
$$;
CREATE OR REPLACE FUNCTION pg_temp.n(k int) RETURNS uuid LANGUAGE sql AS $$
  SELECT ('66666666-0000-4000-a000-' || lpad(k::text, 12, '0'))::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.today() TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.n(int) TO PUBLIC;

-- Fixtures. Every invoice has one item of 1000 net at 19 %, so its gross is 1190.
--  101 skonto   issued; payment 1150 and write-off 40 are booked below, then it is cancelled
--  102 refunded cancelled, payment 1000 (entry e1), refund 300 (entry e2)
--  103 target   issued, same customer: the corrected copy
--  104 plain    cancelled, payment 500 (entry e3): a transfer within the credit still works
--  105 notice   issued, a notice that is stored and sent
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES ('aaaaaaaa-0000-4000-a000-0000000000d1','authenticated','authenticated','of-producer@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000d1','OF Org','of-org','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000d1','aaaaaaaa-0000-4000-a000-0000000000d1','producer');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, last_name, street, postal_code, city) VALUES
  ('cccccccc-0000-4000-c000-0000000000d1','bbbbbbbb-0000-4000-b000-0000000000d1','K-1','private','Eins','Weg 1','01067','Dresden');
INSERT INTO werkbank.invoices (id, org_id, type, customer_id, invoice_no, status, issue_date, due_date, seller_snapshot, buyer_snapshot)
SELECT pg_temp.n(v.k), 'bbbbbbbb-0000-4000-b000-0000000000d1', 'invoice', 'cccccccc-0000-4000-c000-0000000000d1',
       'RE-' || v.k, v.st, pg_temp.today() - 20, pg_temp.today() - 5, '{}', '{}'
FROM (VALUES (101,'issued'),(102,'cancelled'),(103,'issued'),(104,'cancelled'),(105,'issued')) AS v(k, st);
INSERT INTO werkbank.document_items (org_id, invoice_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate)
SELECT i.org_id, i.id, 0, 'item', 'Arbeit', 1, 'HUR', 1000, 0, 19 FROM werkbank.invoices i
WHERE i.org_id = 'bbbbbbbb-0000-4000-b000-0000000000d1';
INSERT INTO werkbank.invoice_entries (id, org_id, invoice_id, kind, amount, booked_on, created_by) VALUES
  ('77777777-0000-4000-a000-0000000000e1','bbbbbbbb-0000-4000-b000-0000000000d1',pg_temp.n(102),'payment',1000,pg_temp.today() - 3,'aaaaaaaa-0000-4000-a000-0000000000d1'),
  ('77777777-0000-4000-a000-0000000000e2','bbbbbbbb-0000-4000-b000-0000000000d1',pg_temp.n(102),'refund',300,pg_temp.today() - 2,'aaaaaaaa-0000-4000-a000-0000000000d1'),
  ('77777777-0000-4000-a000-0000000000e3','bbbbbbbb-0000-4000-b000-0000000000d1',pg_temp.n(104),'payment',500,pg_temp.today() - 3,'aaaaaaaa-0000-4000-a000-0000000000d1');
INSERT INTO werkbank.dunning_notices (id, org_id, invoice_id, stage, notice_date, payment_deadline, invoice_gross, paid_amount, open_amount,
  delivery, pdf_path, pdf_sha256, sent_at, sent_to, created_by) VALUES
  ('88888888-0000-4000-a000-0000000000d1','bbbbbbbb-0000-4000-b000-0000000000d1',pg_temp.n(105),1,pg_temp.today(),pg_temp.today() + 7,
   1190,0,1190,'email','x/dunning/n.pdf','abc',now(),ARRAY['a@example.com'],'aaaaaaaa-0000-4000-a000-0000000000d1');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(text) TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.open(k int) RETURNS numeric LANGUAGE sql SECURITY DEFINER AS $$
  SELECT werkbank.invoice_open_amount(pg_temp.n(k))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.open(int) TO PUBLIC;

-- Cancelled invoices whose status changes in the middle of the test: as the test owner, triggers off.
CREATE OR REPLACE FUNCTION pg_temp.cancel(k int) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  UPDATE werkbank.invoices SET status = 'cancelled' WHERE id = pg_temp.n(k);
  SET LOCAL session_replication_role = DEFAULT;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.cancel(int) TO PUBLIC;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000d1');
SET LOCAL ROLE authenticated;

-- 1. Skonto, then cancellation: the write-off no longer counts -----------------------------------
SELECT lives_ok($$SELECT werkbank.record_invoice_entry(pg_temp.n(101), 'payment', 1150, pg_temp.today())$$, 'payment 1150');
SELECT lives_ok($$SELECT werkbank.record_invoice_entry(pg_temp.n(101), 'write_off', 40, pg_temp.today(), NULL, 'skonto')$$, 'skonto 40');
SELECT is(pg_temp.open(101), 0::numeric, 'settled by payment and skonto');
SELECT pg_temp.cancel(101);
SELECT is(pg_temp.open(101), -1150::numeric, 'after cancellation the credit is the paid 1150, not 1190');
SELECT results_eq(
  $$SELECT claim, paid, written_off, open_amount, payment_state FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(101)$$,
  $$VALUES (0::numeric, 1150::numeric, 0::numeric, -1150::numeric, 'overpaid'::text)$$,
  'invoice_balances shows no written_off for a cancelled invoice');
SELECT throws_ok($$SELECT werkbank.record_invoice_entry(pg_temp.n(101), 'refund', 1190, pg_temp.today())$$,
  '22023', 'refund_exceeds_credit', 'refunding the claim fails');
SELECT lives_ok($$SELECT werkbank.record_invoice_entry(pg_temp.n(101), 'refund', 1150, pg_temp.today())$$,
  'refunding what was paid works');
SELECT results_eq(
  $$SELECT open_amount, payment_state FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(101)$$,
  $$VALUES (0::numeric, 'void'::text)$$, 'after the refund the cancelled invoice is void, no credit left');

-- 2. Refund, then transfer of the payment from a cancelled invoice ------------------------------
SELECT is(pg_temp.open(102), -700::numeric, 'cancelled with payment 1000 and refund 300 has credit 700');
SELECT throws_ok($$SELECT werkbank.transfer_invoice_entry('77777777-0000-4000-a000-0000000000e1', pg_temp.n(103), 'Umbuchung')$$,
  '22023', 'transfer_exceeds_credit', 'transferring more than the credit fails');
SELECT is(pg_temp.open(102), -700::numeric, 'the failed transfer changed nothing on the source');
SELECT is(pg_temp.open(103), 1190::numeric, 'the failed transfer changed nothing on the target');
SELECT lives_ok($$SELECT werkbank.transfer_invoice_entry('77777777-0000-4000-a000-0000000000e3', pg_temp.n(103), 'Umbuchung')$$,
  'a transfer within the credit of a cancelled invoice works');
SELECT is(pg_temp.open(104), 0::numeric, 'the source is settled after the transfer');

-- 2b. A hold cannot end in the past (it would never count as active) ---------------------------
SELECT throws_ok($$SELECT werkbank.set_dunning_hold(pg_temp.n(103), 'Reklamation', pg_temp.today() - 1)$$,
  '22023', 'hold_until_past', 'a hold ending yesterday is refused');
SELECT lives_ok($$SELECT werkbank.set_dunning_hold(pg_temp.n(103), 'Reklamation', pg_temp.today())$$,
  'a hold ending today is accepted');
SELECT lives_ok($$SELECT werkbank.set_dunning_hold(pg_temp.n(103), 'Reklamation', NULL)$$,
  'a hold without an end date is accepted');

-- 3. The formula holds row by row ------------------------------------------------------------------
SELECT is((SELECT count(*)::int FROM werkbank.invoice_balances WHERE open_amount <> claim - paid - written_off), 0,
  'open_amount = claim - paid - written_off for every row');

-- 4. sent_at cannot be cleared -----------------------------------------------------------------------
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE werkbank.dunning_notices SET sent_at = NULL WHERE id = '88888888-0000-4000-a000-0000000000d1'$$,
  '55000', 'dunning_locked', 'the service role cannot clear sent_at');
SELECT lives_ok($$UPDATE werkbank.dunning_notices SET sent_at = now(), sent_to = ARRAY['b@example.com'] WHERE id = '88888888-0000-4000-a000-0000000000d1'$$,
  'a resend still updates sent_at and sent_to');

SELECT * FROM finish();
ROLLBACK;
