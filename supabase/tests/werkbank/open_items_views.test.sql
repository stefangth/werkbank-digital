-- Werkbank Teil 5 (R3, R4): views invoice_balances and dunning_due, protection of notice files.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(51);

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
--  1 open    due in 5 days        2 part   due 3 days ago, payment 500
--  3 paid    payment 1190         4 wo     write-off 1190
--  5 over    payment 1300         6 void   cancelled, no entries
--  7 credit  cancelled, payment 800   8 cancellation of 6   9 draft
-- 10 refund  payment 1190, refund 190, reversed payment 999
-- 11 d7 due 7 days ago   12 d6 due 6 days ago
-- 13 s2 stage 1 notice 14 days ago   14 s2x stage 1 notice 13 days ago
-- 15 s3 stage 2 notice 14 days ago   16 done stage 3 notice
-- 17 held (no end)   18 hold ended yesterday   19 hold until today
-- 20 paid and long overdue   21 due 10 days ago   22 reversed write-off, due 30 days ago
-- 30 org B, due 30 days ago
SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000f1','authenticated','authenticated','ob-admin-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000f2','authenticated','authenticated','ob-admin-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','OB Org A','ob-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000f2','OB Org B','ob-org-b','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','aaaaaaaa-0000-4000-a000-0000000000f1','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000000f2','aaaaaaaa-0000-4000-a000-0000000000f2','admin');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, first_name, last_name, company_name, street, postal_code, city, email, invoice_email) VALUES
  ('cccccccc-0000-4000-c000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','K-1','private','Hans','Müller',NULL,'Weg 1','01067','Dresden','hans@kunde.test',NULL),
  ('cccccccc-0000-4000-c000-0000000000f2','bbbbbbbb-0000-4000-b000-0000000000f1','K-2','property_manager',NULL,NULL,'HV Nord GmbH','Ring 2','01069','Dresden','info@hv.test','rechnung@hv.test'),
  ('cccccccc-0000-4000-c000-0000000000f3','bbbbbbbb-0000-4000-b000-0000000000f2','K-1','private','Eva','Fremd',NULL,'Weg 3','01067','Dresden',NULL,NULL);
INSERT INTO werkbank.properties (id, org_id, customer_id, name, street, postal_code, city) VALUES
  ('dddddddd-0000-4000-d000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f2',
   'Objekt Linden','Lindenstr. 5','01099','Dresden');
INSERT INTO werkbank.contacts (id, org_id, customer_id, first_name, last_name, email) VALUES
  ('eeeeeeee-0000-4000-e000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f2','Kai','Kontakt','kai@hv.test');
INSERT INTO werkbank.company_profiles (org_id, company_name, street, postal_code, city, email, tax_number, iban, payment_due_days) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','Werkbank GmbH','Hof 3','01067','Dresden','info@werkbank.test','201/123/45678',
   'DE89370400440532013000',14);

INSERT INTO werkbank.invoices (id, org_id, type, cancels_invoice_id, customer_id, property_id, contact_id, invoice_no, status, issue_date, due_date, seller_snapshot, buyer_snapshot)
SELECT pg_temp.n(v.k), 'bbbbbbbb-0000-4000-b000-0000000000f1', v.typ,
       CASE WHEN v.typ = 'cancellation' THEN pg_temp.n(6) END,
       'cccccccc-0000-4000-c000-0000000000f2',
       CASE WHEN v.k = 1 THEN 'dddddddd-0000-4000-d000-0000000000f1'::uuid END,
       CASE WHEN v.k = 1 THEN 'eeeeeeee-0000-4000-e000-0000000000f1'::uuid END,
       CASE WHEN v.st = 'draft' THEN NULL ELSE 'RE-' || lpad(v.k::text, 4, '0') END,
       v.st,
       CASE WHEN v.st = 'draft' THEN NULL ELSE pg_temp.today() - 40 END,
       CASE WHEN v.st = 'draft' THEN NULL ELSE pg_temp.today() + v.due END,
       CASE WHEN v.st = 'draft' THEN NULL ELSE '{}'::jsonb END,
       CASE WHEN v.st = 'draft' THEN NULL ELSE '{}'::jsonb END
FROM (VALUES
  (1,'invoice','issued',5),(2,'invoice','issued',-3),(3,'invoice','issued',-30),(4,'invoice','issued',-30),
  (5,'invoice','issued',-30),(6,'invoice','cancelled',-30),(7,'invoice','cancelled',-30),
  (8,'cancellation','issued',-30),(9,'invoice','draft',0),(10,'invoice','issued',-30),
  (11,'invoice','issued',-7),(12,'invoice','issued',-6),(13,'invoice','issued',-30),(14,'invoice','issued',-30),
  (15,'invoice','issued',-30),(16,'invoice','issued',-30),(17,'invoice','issued',-30),(18,'invoice','issued',-30),
  (19,'invoice','issued',-30),(20,'invoice','issued',-30),(21,'invoice','issued',-10),(22,'invoice','issued',-30)
) AS v(k, typ, st, due);
INSERT INTO werkbank.invoices (id, org_id, type, customer_id, invoice_no, status, issue_date, due_date, seller_snapshot, buyer_snapshot) VALUES
  (pg_temp.n(30),'bbbbbbbb-0000-4000-b000-0000000000f2','invoice','cccccccc-0000-4000-c000-0000000000f3','RE-0001','issued',
   pg_temp.today() - 40, pg_temp.today() - 30,'{}','{}');
INSERT INTO werkbank.document_items (org_id, invoice_id, sort_order, kind, name, quantity, unit_code, labour_price, material_price, vat_rate)
SELECT i.org_id, i.id, 0, 'item', 'Arbeit', 1, 'HUR', 1000, 0, 19 FROM werkbank.invoices i
WHERE i.id::text LIKE '66666666-0000-4000-a000-0000000000__' AND i.type = 'invoice';

INSERT INTO werkbank.invoice_entries (org_id, invoice_id, kind, amount, booked_on, write_off_reason, reversed_at, reversed_by, reversal_reason, created_by)
SELECT 'bbbbbbbb-0000-4000-b000-0000000000f1', pg_temp.n(v.k), v.kind, v.amount, pg_temp.today() - 1, v.wo,
       CASE WHEN v.rev THEN now() END,
       CASE WHEN v.rev THEN 'aaaaaaaa-0000-4000-a000-0000000000f1'::uuid END,
       CASE WHEN v.rev THEN 'Fehler' END,
       'aaaaaaaa-0000-4000-a000-0000000000f1'
FROM (VALUES
  (2,'payment',500,NULL,false),(3,'payment',1190,NULL,false),(4,'write_off',1190,'goodwill',false),
  (5,'payment',1300,NULL,false),(7,'payment',800,NULL,false),
  (10,'payment',1190,NULL,false),(10,'refund',190,NULL,false),(10,'payment',999,NULL,true),
  (20,'payment',1190,NULL,false),(22,'write_off',1190,'goodwill',true)
) AS v(k, kind, amount, wo, rev);

INSERT INTO werkbank.dunning_notices (org_id, invoice_id, stage, notice_date, payment_deadline, invoice_gross, paid_amount, open_amount, delivery, created_by)
SELECT 'bbbbbbbb-0000-4000-b000-0000000000f1', pg_temp.n(v.k), v.stage, pg_temp.today() - v.ago, pg_temp.today() + 7,
       1190, 0, 1190, 'print', 'aaaaaaaa-0000-4000-a000-0000000000f1'
FROM (VALUES
  (13,1,14),(14,1,13),(15,1,40),(15,2,14),(16,1,60),(16,2,40),(16,3,20)
) AS v(k, stage, ago);

INSERT INTO werkbank.dunning_holds (org_id, invoice_id, reason, until, created_by) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1', pg_temp.n(17), 'Klaerung', NULL, 'aaaaaaaa-0000-4000-a000-0000000000f1'),
  ('bbbbbbbb-0000-4000-b000-0000000000f1', pg_temp.n(18), 'Abgelaufen', pg_temp.today() - 1, 'aaaaaaaa-0000-4000-a000-0000000000f1'),
  ('bbbbbbbb-0000-4000-b000-0000000000f1', pg_temp.n(19), 'Bis heute', pg_temp.today(), 'aaaaaaaa-0000-4000-a000-0000000000f1');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.act_as(text) TO PUBLIC;

-- Structure --------------------------------------------------------------------------------------
SELECT is((SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
           WHERE attrelid = 'werkbank.invoice_balances'::regclass AND attnum > 0 AND NOT attisdropped),
  ARRAY['invoice_id','org_id','invoice_no','status','customer_id','property_id','customer_name','property_name',
        'issue_date','due_date','claim','paid','written_off','open_amount','payment_state','days_overdue',
        'last_stage','last_notice_date','hold_reason','hold_until'],
  'invoice_balances has the specified columns');
SELECT is((SELECT array_agg(attname::text ORDER BY attnum) FROM pg_attribute
           WHERE attrelid = 'werkbank.dunning_due'::regclass AND attnum > 20 AND NOT attisdropped),
  ARRAY['next_stage','customer_invoice_email','contact_email','customer_email'],
  'dunning_due adds next_stage and the raw addresses');
SELECT is((SELECT array_agg(c.relname::text ORDER BY c.relname) FROM pg_class c
           WHERE c.oid IN ('werkbank.invoice_balances'::regclass, 'werkbank.dunning_due'::regclass)
             AND 'security_invoker=true' = ANY (c.reloptions)),
  ARRAY['dunning_due','invoice_balances'], 'both views are security_invoker');

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f1');
SET LOCAL ROLE authenticated;

-- invoice_balances ---------------------------------------------------------------------------------
SELECT is((SELECT payment_state FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(1)), 'open', 'payment_state open');
SELECT results_eq($$SELECT claim, paid, written_off, open_amount, days_overdue FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(1)$$,
  $$VALUES (1190.00::numeric, 0::numeric, 0::numeric, 1190.00::numeric, 0)$$, 'an invoice not due has 0 days overdue');
SELECT is((SELECT payment_state FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(2)), 'partial', 'payment_state partial');
SELECT results_eq($$SELECT claim, paid, written_off, open_amount, days_overdue FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(2)$$,
  $$VALUES (1190.00::numeric, 500::numeric, 0::numeric, 690.00::numeric, 3)$$, 'an invoice due 3 days ago has 3 days overdue');
SELECT is((SELECT payment_state FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(3)), 'paid', 'payment_state paid');
SELECT is((SELECT days_overdue FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(3)), 0, 'a paid invoice has 0 days overdue');
SELECT is((SELECT payment_state FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(4)), 'written_off', 'payment_state written_off');
SELECT results_eq($$SELECT paid, written_off, open_amount FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(4)$$,
  $$VALUES (0::numeric, 1190.00::numeric, 0::numeric)$$, 'a written-off invoice shows the write-off');
SELECT is((SELECT payment_state FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(5)), 'overpaid', 'payment_state overpaid');
SELECT is((SELECT open_amount FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(5)), -110.00::numeric, 'overpayment is negative open');
SELECT is((SELECT payment_state FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(6)), 'void', 'payment_state void');
SELECT results_eq($$SELECT claim, open_amount FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(6)$$,
  $$VALUES (0::numeric, 0::numeric)$$, 'a cancelled invoice has claim 0');
SELECT is((SELECT payment_state FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(7)), 'overpaid', 'a cancelled invoice with a payment is overpaid');
SELECT results_eq($$SELECT claim, paid, open_amount FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(7)$$,
  $$VALUES (0::numeric, 800::numeric, -800.00::numeric)$$, 'the cancelled invoice shows claim 0 and its credit');
SELECT is((SELECT count(*)::int FROM werkbank.invoice_balances WHERE invoice_id IN (pg_temp.n(8), pg_temp.n(9))), 0,
  'cancellation invoices and drafts are absent');
SELECT results_eq($$SELECT paid, open_amount, payment_state FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(10)$$,
  $$VALUES (1000::numeric, 190.00::numeric, 'partial')$$, 'paid is payments minus refunds, reversed entries are ignored');
SELECT results_eq($$SELECT written_off, open_amount, payment_state FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(22)$$,
  $$VALUES (0::numeric, 1190.00::numeric, 'open')$$, 'a reversed write-off does not count');
SELECT is((SELECT count(*)::int FROM werkbank.invoice_balances WHERE open_amount <> claim - paid - written_off), 0,
  'open_amount = claim - paid - written_off for every fixture');
SELECT results_eq(
  $$SELECT invoice_no, customer_name, property_name, due_date, last_stage, last_notice_date, hold_reason, hold_until
    FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(1)$$,
  $$VALUES ('RE-0001', 'HV Nord GmbH', 'Objekt Linden', pg_temp.today() + 5, NULL::smallint, NULL::date, NULL::text, NULL::date)$$,
  'header columns come from invoice, customer and property');
SELECT results_eq($$SELECT last_stage, last_notice_date FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(15)$$,
  $$VALUES (2::smallint, pg_temp.today() - 14)$$, 'last_stage and last_notice_date come from the highest notice');
SELECT results_eq($$SELECT hold_reason, hold_until FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(19)$$,
  $$VALUES ('Bis heute', pg_temp.today())$$, 'a hold until today is active');
SELECT is((SELECT hold_reason FROM werkbank.invoice_balances WHERE invoice_id = pg_temp.n(18)), NULL, 'an ended hold is not shown');

-- dunning_due ----------------------------------------------------------------------------------------
SELECT results_eq($$SELECT next_stage FROM werkbank.dunning_due WHERE invoice_id = pg_temp.n(11)$$,
  $$VALUES (1)$$, 'stage 1 is due 7 days after the due date');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_due WHERE invoice_id = pg_temp.n(12)), 0, 'not due at 6 days');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_due WHERE invoice_id = pg_temp.n(1)), 0, 'an invoice not yet due is not listed');
SELECT results_eq($$SELECT next_stage FROM werkbank.dunning_due WHERE invoice_id = pg_temp.n(13)$$,
  $$VALUES (2)$$, 'stage 2 is due 14 days after the reminder');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_due WHERE invoice_id = pg_temp.n(14)), 0, 'stage 2 not due at 13 days');
SELECT results_eq($$SELECT next_stage FROM werkbank.dunning_due WHERE invoice_id = pg_temp.n(15)$$,
  $$VALUES (3)$$, 'stage 3 is due 14 days after stage 2');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_due WHERE invoice_id = pg_temp.n(16)), 0, 'an invoice at stage 3 is excluded');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_due WHERE invoice_id IN (pg_temp.n(17), pg_temp.n(19))), 0, 'invoices with an active hold are excluded');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_due WHERE invoice_id = pg_temp.n(18)), 1, 'an ended hold does not exclude');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_due WHERE invoice_id IN (pg_temp.n(3), pg_temp.n(4), pg_temp.n(5), pg_temp.n(20))), 0,
  'paid, written-off and overpaid invoices are excluded');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_due WHERE invoice_id IN (pg_temp.n(6), pg_temp.n(7))), 0, 'cancelled invoices are excluded');
SELECT results_eq($$SELECT customer_invoice_email, contact_email, customer_email FROM werkbank.dunning_due WHERE invoice_id = pg_temp.n(11)$$,
  $$VALUES ('rechnung@hv.test', NULL::text, 'info@hv.test')$$, 'the raw addresses of customer and contact are returned');
SELECT results_eq($$SELECT contact_email FROM werkbank.dunning_due WHERE invoice_id = pg_temp.n(21)$$,
  $$VALUES (NULL::text)$$, 'an invoice without a contact has no contact_email');

-- Changed profile wait days
RESET ROLE;
UPDATE werkbank.company_profiles SET reminder_after_days = 10 WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000f1';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.dunning_due WHERE invoice_id = pg_temp.n(11)), 0, 'a longer reminder wait excludes the invoice at 7 days');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_due WHERE invoice_id = pg_temp.n(21)), 1, 'and includes it at 10 days');
RESET ROLE;
UPDATE werkbank.company_profiles SET dunning1_after_days = 20 WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000f1';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.dunning_due WHERE invoice_id = pg_temp.n(13)), 0, 'a longer stage 2 wait excludes the invoice at 14 days');
RESET ROLE;
DELETE FROM werkbank.company_profiles WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000f1';
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.dunning_due WHERE invoice_id = pg_temp.n(11)), 1, 'without a profile the default 7 days apply');

-- Another org sees nothing -----------------------------------------------------------------------------
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f2');
SELECT is((SELECT count(*)::int FROM werkbank.invoice_balances WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000f1'), 0,
  'the admin of another org sees no invoice_balances rows');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_due WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000f1'), 0,
  'the admin of another org sees no dunning_due rows');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_due), 1, 'and sees only their own due invoice');
RESET ROLE;

-- Storage: notice files are immutable ------------------------------------------------------------------------
SET LOCAL storage.allow_delete_query = 'true';
SET LOCAL ROLE service_role;
INSERT INTO storage.objects (bucket_id, name) VALUES
  ('werkbank-documents', 'bbbbbbbb-0000-4000-b000-0000000000f1/dunning/x.pdf'),
  ('werkbank-documents', 'bbbbbbbb-0000-4000-b000-0000000000f1/invoices/i.pdf'),
  ('werkbank-documents', 'bbbbbbbb-0000-4000-b000-0000000000f1/quotes/x.pdf');
SELECT throws_ok($$UPDATE storage.objects SET name = 'bbbbbbbb-0000-4000-b000-0000000000f1/dunning/y.pdf'
  WHERE name = 'bbbbbbbb-0000-4000-b000-0000000000f1/dunning/x.pdf'$$,
  '55000', 'dunning_locked', 'a notice file cannot be updated');
SELECT throws_ok($$DELETE FROM storage.objects WHERE name = 'bbbbbbbb-0000-4000-b000-0000000000f1/dunning/x.pdf'$$,
  '55000', 'dunning_locked', 'a notice file cannot be deleted');
SELECT throws_ok($$DELETE FROM storage.objects WHERE name = 'bbbbbbbb-0000-4000-b000-0000000000f1/invoices/i.pdf'$$,
  '55000', 'invoice_locked', 'an invoice file still raises invoice_locked');
SELECT lives_ok($$DELETE FROM storage.objects WHERE name = 'bbbbbbbb-0000-4000-b000-0000000000f1/quotes/x.pdf'$$,
  'a quote file can still be deleted');
RESET ROLE;
SELECT lives_ok($$DELETE FROM public.organizations WHERE id = 'bbbbbbbb-0000-4000-b000-0000000000f1'$$,
  'the org can be deleted');
SET LOCAL ROLE service_role;
SELECT lives_ok($$DELETE FROM storage.objects WHERE name = 'bbbbbbbb-0000-4000-b000-0000000000f1/dunning/x.pdf'$$,
  'after the org is deleted its notice file can be deleted');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
