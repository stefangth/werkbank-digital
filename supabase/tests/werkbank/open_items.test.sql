-- Werkbank Teil 5: invoice_entries, dunning_notices, dunning_holds, company_profiles dunning columns.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(34);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000f2','authenticated','authenticated','oi-producer-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000f3','authenticated','authenticated','oi-tech-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000f4','authenticated','authenticated','oi-admin-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','OI Org A','oi-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000f2','OI Org B','oi-org-b','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','aaaaaaaa-0000-4000-a000-0000000000f2','producer'),
  ('bbbbbbbb-0000-4000-b000-0000000000f1','aaaaaaaa-0000-4000-a000-0000000000f3','artist'),
  ('bbbbbbbb-0000-4000-b000-0000000000f2','aaaaaaaa-0000-4000-a000-0000000000f4','admin');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, last_name, street, postal_code, city) VALUES
  ('cccccccc-0000-4000-c000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','K-1','private','Eins','Weg 1','01067','Dresden');
INSERT INTO werkbank.invoices (id, org_id, customer_id) VALUES
  ('66666666-0000-4000-a000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f1'),
  ('66666666-0000-4000-a000-0000000000f2','bbbbbbbb-0000-4000-b000-0000000000f1','cccccccc-0000-4000-c000-0000000000f1');
INSERT INTO werkbank.company_profiles (org_id, company_name, street, postal_code, city) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','OI Firma','Weg 1','01067','Dresden');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

SELECT has_table('werkbank', 'invoice_entries', 'invoice_entries exists');
SELECT has_table('werkbank', 'dunning_notices', 'dunning_notices exists');
SELECT has_table('werkbank', 'dunning_holds', 'dunning_holds exists');
SELECT ok((SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'werkbank' AND c.relname IN ('invoice_entries','dunning_notices','dunning_holds')),
  'RLS is enabled on the three tables');
SELECT table_privs_are('werkbank', 'invoice_entries', 'authenticated', ARRAY['SELECT'], 'authenticated only selects invoice_entries');
SELECT table_privs_are('werkbank', 'dunning_notices', 'authenticated', ARRAY['SELECT'], 'authenticated only selects dunning_notices');
SELECT table_privs_are('werkbank', 'dunning_holds', 'authenticated', ARRAY['SELECT'], 'authenticated only selects dunning_holds');

-- Owner inserts (no triggers yet in this migration).
SELECT lives_ok($$INSERT INTO werkbank.invoice_entries (id, org_id, invoice_id, kind, amount, booked_on, created_by)
  VALUES ('77777777-0000-4000-a000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f1','payment',10,'2026-10-01','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  'owner inserts a payment entry');
SELECT lives_ok($$INSERT INTO werkbank.dunning_notices (id, org_id, invoice_id, stage, notice_date, payment_deadline, invoice_gross, paid_amount, open_amount, delivery, created_by)
  VALUES ('88888888-0000-4000-a000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f1',1,'2026-10-08','2026-10-15',100,10,90,'email','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  'owner inserts a notice');
SELECT lives_ok($$INSERT INTO werkbank.dunning_holds (org_id, invoice_id, reason, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f1','Klaerung','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  'owner inserts a hold');

-- Visibility.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f2');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.invoice_entries), 1, 'producer A reads the entry');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_notices), 1, 'producer A reads the notice');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_holds), 1, 'producer A reads the hold');
SELECT throws_ok($$INSERT INTO werkbank.invoice_entries (org_id, invoice_id, kind, amount, booked_on, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f1','payment',5,'2026-10-01','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  '42501', NULL, 'producer A cannot insert an entry directly');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f3');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.invoice_entries), 0, 'technician of org A sees no entries');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_notices), 0, 'technician of org A sees no notices');
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f4');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.invoice_entries), 0, 'admin of org B sees no entries');
SELECT is((SELECT count(*)::int FROM werkbank.dunning_holds), 0, 'admin of org B sees no holds');
RESET ROLE;

-- invoice_entries checks.
SELECT throws_ok($$INSERT INTO werkbank.invoice_entries (org_id, invoice_id, kind, amount, booked_on, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f1','write_off',5,'2026-10-01','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  '23514', NULL, 'write_off without reason is rejected');
SELECT throws_ok($$INSERT INTO werkbank.invoice_entries (org_id, invoice_id, kind, amount, booked_on, write_off_reason, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f1','payment',5,'2026-10-01','skonto','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  '23514', NULL, 'a payment with a write-off reason is rejected');
SELECT throws_ok($$INSERT INTO werkbank.invoice_entries (org_id, invoice_id, kind, amount, booked_on, write_off_reason, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f1','write_off',5,'2026-10-01','other','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  '23514', NULL, 'reason other without note is rejected');
SELECT lives_ok($$INSERT INTO werkbank.invoice_entries (org_id, invoice_id, kind, amount, booked_on, write_off_reason, note, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f1','write_off',5,'2026-10-01','other','Kulanz','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  'reason other with a note is accepted');
SELECT throws_ok($$INSERT INTO werkbank.invoice_entries (org_id, invoice_id, kind, amount, booked_on, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f1','payment',0,'2026-10-01','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  '23514', NULL, 'amount 0 is rejected');
SELECT throws_ok($$INSERT INTO werkbank.invoice_entries (org_id, invoice_id, kind, amount, booked_on, reversed_at, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f1','payment',5,'2026-10-01',now(),'aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  '23514', NULL, 'a reversal with only reversed_at is rejected');
SELECT lives_ok($$INSERT INTO werkbank.invoice_entries (org_id, invoice_id, kind, amount, booked_on, reversed_at, reversed_by, reversal_reason, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f1','payment',5,'2026-10-01',now(),'aaaaaaaa-0000-4000-a000-0000000000f2','Vertippt','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  'a complete reversal is accepted');

-- dunning_notices checks.
SELECT throws_ok($$INSERT INTO werkbank.dunning_notices (org_id, invoice_id, stage, notice_date, payment_deadline, invoice_gross, paid_amount, open_amount, delivery, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f2',4,'2026-10-08','2026-10-15',100,0,100,'email','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  '23514', NULL, 'stage 4 is rejected');
SELECT throws_ok($$INSERT INTO werkbank.dunning_notices (org_id, invoice_id, stage, notice_date, payment_deadline, invoice_gross, paid_amount, open_amount, delivery, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f1',1,'2026-10-09','2026-10-16',100,0,100,'email','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  '23505', NULL, 'a second stage 1 for the same invoice is rejected');
SELECT throws_ok($$INSERT INTO werkbank.dunning_notices (org_id, invoice_id, stage, notice_date, payment_deadline, invoice_gross, paid_amount, open_amount, delivery, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f2',1,'2026-10-08','2026-10-07',100,0,100,'email','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  '23514', NULL, 'payment_deadline before notice_date is rejected');
SELECT throws_ok($$INSERT INTO werkbank.dunning_notices (org_id, invoice_id, stage, notice_date, payment_deadline, invoice_gross, paid_amount, open_amount, delivery, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f2',1,'2026-10-08','2026-10-15',100,100,0,'email','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  '23514', NULL, 'open_amount 0 is rejected');

-- dunning_holds checks.
SELECT throws_ok($$INSERT INTO werkbank.dunning_holds (org_id, invoice_id, reason, created_by)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','66666666-0000-4000-a000-0000000000f2','   ','aaaaaaaa-0000-4000-a000-0000000000f2')$$,
  '23514', NULL, 'a blank hold reason is rejected');

-- Holds go with the invoice, entries and notices block its deletion.
SELECT throws_ok($$DELETE FROM werkbank.invoices WHERE id = '66666666-0000-4000-a000-0000000000f1'$$,
  '23503', NULL, 'an invoice with entries cannot be deleted');

-- company_profiles.
SELECT is((SELECT reminder_after_days FROM werkbank.company_profiles WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000f1'),
  7, 'reminder_after_days defaults to 7');
SELECT is((SELECT dunning1_after_days || '/' || dunning2_after_days || '/' || dunning_deadline_days
  FROM werkbank.company_profiles WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000f1'),
  '14/14/7', 'the other dunning defaults are 14, 14 and 7');
SELECT throws_ok($$UPDATE werkbank.company_profiles SET reminder_after_days = 366 WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000f1'$$,
  '23514', NULL, 'reminder_after_days 366 is rejected');

SELECT * FROM finish();
ROLLBACK;
