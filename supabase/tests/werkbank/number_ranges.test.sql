-- Werkbank Teil 2: number ranges and automatic customer numbers.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(16);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000f1','authenticated','authenticated','nr-admin-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000f2','authenticated','authenticated','nr-producer-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000f4','authenticated','authenticated','nr-admin-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','NR Org A','nr-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000f2','NR Org B','nr-org-b','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','aaaaaaaa-0000-4000-a000-0000000000f1','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000000f1','aaaaaaaa-0000-4000-a000-0000000000f2','producer'),
  ('bbbbbbbb-0000-4000-b000-0000000000f2','aaaaaaaa-0000-4000-a000-0000000000f4','admin');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.upd_count(_set text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE format('WITH u AS (UPDATE werkbank.number_ranges SET %s RETURNING 1) SELECT count(*)::int FROM u', _set) INTO n;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.upd_count(text) TO PUBLIC;

SELECT has_table('werkbank', 'number_ranges', 'number_ranges exists');

-- Admin A: generated numbers.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f1');
SET LOCAL ROLE authenticated;
INSERT INTO werkbank.customers (id, org_id, kind, company_name, street, postal_code, city)
VALUES ('cccccccc-0000-4000-c000-0000000000b1','bbbbbbbb-0000-4000-b000-0000000000f1','property_manager','Erste GmbH','Hauptstr. 1','01067','Dresden');
INSERT INTO werkbank.customers (id, org_id, kind, company_name, street, postal_code, city)
VALUES ('cccccccc-0000-4000-c000-0000000000b2','bbbbbbbb-0000-4000-b000-0000000000f1','property_manager','Zweite GmbH','Hauptstr. 2','01067','Dresden');
SELECT is((SELECT customer_no FROM werkbank.customers WHERE id = 'cccccccc-0000-4000-c000-0000000000b1'), 'K-10001', 'first customer gets K-10001');
SELECT is((SELECT customer_no FROM werkbank.customers WHERE id = 'cccccccc-0000-4000-c000-0000000000b2'), 'K-10002', 'second customer gets K-10002');

-- A supplied number is kept and consumes nothing.
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, company_name, street, postal_code, city)
VALUES ('cccccccc-0000-4000-c000-0000000000b3','bbbbbbbb-0000-4000-b000-0000000000f1','ALT-7','property_manager','Alt GmbH','Hauptstr. 3','01067','Dresden');
SELECT is((SELECT customer_no FROM werkbank.customers WHERE id = 'cccccccc-0000-4000-c000-0000000000b3'), 'ALT-7', 'supplied customer_no is kept');
INSERT INTO werkbank.customers (id, org_id, kind, company_name, street, postal_code, city)
VALUES ('cccccccc-0000-4000-c000-0000000000b4','bbbbbbbb-0000-4000-b000-0000000000f1','property_manager','Dritte GmbH','Hauptstr. 4','01067','Dresden');
SELECT is((SELECT customer_no FROM werkbank.customers WHERE id = 'cccccccc-0000-4000-c000-0000000000b4'), 'K-10003', 'supplied number consumed nothing, next is K-10003');

-- A failed insert (rolled back to its savepoint) does not consume a number.
SELECT throws_ok($$INSERT INTO werkbank.customers (org_id, kind, company_name, street, postal_code, city)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','property_manager','Kaputt GmbH','Hauptstr. 5','123','Dresden')$$,
  '23514', NULL, 'insert failing a check is rejected');
INSERT INTO werkbank.customers (id, org_id, kind, company_name, street, postal_code, city)
VALUES ('cccccccc-0000-4000-c000-0000000000b5','bbbbbbbb-0000-4000-b000-0000000000f1','property_manager','Vierte GmbH','Hauptstr. 6','01067','Dresden');
SELECT is((SELECT customer_no FROM werkbank.customers WHERE id = 'cccccccc-0000-4000-c000-0000000000b5'), 'K-10004', 'failed insert consumed no number');

-- Admin edits the range: prefix KD, next 5, padding 4.
SELECT is(pg_temp.upd_count($$prefix = 'KD', next_value = 5, padding = 4$$), 1, 'admin A updates the range');
INSERT INTO werkbank.customers (id, org_id, kind, company_name, street, postal_code, city)
VALUES ('cccccccc-0000-4000-c000-0000000000b6','bbbbbbbb-0000-4000-b000-0000000000f1','property_manager','Fuenfte GmbH','Hauptstr. 7','01067','Dresden');
SELECT is((SELECT customer_no FROM werkbank.customers WHERE id = 'cccccccc-0000-4000-c000-0000000000b6'), 'KD0005', 'edited range yields KD0005');

-- A number typed by hand inside the range is skipped by the next automatic number (Ruling R15).
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, company_name, street, postal_code, city)
VALUES ('cccccccc-0000-4000-c000-0000000000b7','bbbbbbbb-0000-4000-b000-0000000000f1','KD0006','property_manager','Hand GmbH','Hauptstr. 8','01067','Dresden');
INSERT INTO werkbank.customers (id, org_id, kind, company_name, street, postal_code, city)
VALUES ('cccccccc-0000-4000-c000-0000000000b8','bbbbbbbb-0000-4000-b000-0000000000f1','property_manager','Sechste GmbH','Hauptstr. 9','01067','Dresden');
SELECT is((SELECT customer_no FROM werkbank.customers WHERE id = 'cccccccc-0000-4000-c000-0000000000b8'), 'KD0007', 'auto number skips the hand-typed KD0006');

-- A counter lowered below existing numbers skips forward to the first free one.
SELECT is(pg_temp.upd_count($$next_value = 5$$), 1, 'admin A lowers next_value to 5');
INSERT INTO werkbank.customers (id, org_id, kind, company_name, street, postal_code, city)
VALUES ('cccccccc-0000-4000-c000-0000000000b9','bbbbbbbb-0000-4000-b000-0000000000f1','property_manager','Siebte GmbH','Hauptstr. 10','01067','Dresden');
SELECT is((SELECT customer_no FROM werkbank.customers WHERE id = 'cccccccc-0000-4000-c000-0000000000b9'), 'KD0008', 'lowered counter skips KD0005..KD0007 and yields KD0008');

-- Producer cannot update.
RESET ROLE;
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f2');
SET LOCAL ROLE authenticated;
SELECT is(pg_temp.upd_count($$prefix = 'X'$$), 0, 'producer A updates 0 rows of number_ranges');

-- authenticated cannot call next_number.
SELECT throws_ok($$SELECT werkbank.next_number('bbbbbbbb-0000-4000-b000-0000000000f1', 'customer')$$,
  '42501', NULL, 'authenticated cannot execute next_number');

-- Unknown key as postgres.
RESET ROLE;
SELECT throws_ok($$SELECT werkbank.next_number('bbbbbbbb-0000-4000-b000-0000000000f1', 'unknown')$$,
  '22023', NULL, 'unknown key raises 22023');

-- Org B has its own range.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000f4');
SET LOCAL ROLE authenticated;
INSERT INTO werkbank.customers (id, org_id, kind, company_name, street, postal_code, city)
VALUES ('cccccccc-0000-4000-c000-0000000000c1','bbbbbbbb-0000-4000-b000-0000000000f2','property_manager','B GmbH','Hauptstr. 1','01067','Dresden');
SELECT is((SELECT customer_no FROM werkbank.customers WHERE id = 'cccccccc-0000-4000-c000-0000000000c1'), 'K-10001', 'org B starts at K-10001');

SELECT * FROM finish();
ROLLBACK;
