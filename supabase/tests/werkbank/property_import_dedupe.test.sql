-- Werkbank Teil 2: import_properties skips a row whose customer and normalized address (street, postal
-- code, city: lowercased, trimmed, internal whitespace collapsed) already exist in the org, both against
-- stored rows and against earlier rows of the same import.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(9);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000e1','authenticated','authenticated','pd-producer-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000e2','authenticated','authenticated','pd-producer-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000e1','PD Org A','pd-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000e2','PD Org B','pd-org-b','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000e1','aaaaaaaa-0000-4000-a000-0000000000e1','producer'),
  ('bbbbbbbb-0000-4000-b000-0000000000e2','aaaaaaaa-0000-4000-a000-0000000000e2','producer');
SET session_replication_role = DEFAULT;

INSERT INTO werkbank.customers (org_id, customer_no, kind, company_name, street, postal_code, city) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000e1','K-30000','property_manager','Verwaltung Eins','A 1','01067','Dresden'),
  ('bbbbbbbb-0000-4000-b000-0000000000e1','K-30001','property_manager','Verwaltung Zwei','A 2','01067','Dresden'),
  ('bbbbbbbb-0000-4000-b000-0000000000e2','K-30000','property_manager','Verwaltung B','A 1','01067','Dresden');

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

CREATE TEMP TABLE res (name text PRIMARY KEY, r jsonb);
GRANT ALL ON res TO PUBLIC;

SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e1');
SET LOCAL ROLE authenticated;

-- First import: row 1 repeats row 0 with different case and whitespace, row 2 is the same address for
-- another customer, row 3 is another address of the first customer.
INSERT INTO res SELECT 'p1', werkbank.import_properties('bbbbbbbb-0000-4000-b000-0000000000e1', $j$[
  {"customer_no":"K-30000","name":"WEG Hauptstrasse","street":"Hauptstraße 5","postal_code":"01067","city":"Dresden"},
  {"customer_no":"K-30000","name":"WEG Hauptstrasse Kopie","street":"  hauptstraße   5 ","postal_code":" 01067","city":"DRESDEN "},
  {"customer_no":"K-30001","name":"WEG Hauptstrasse Zwei","street":"Hauptstraße 5","postal_code":"01067","city":"Dresden"},
  {"customer_no":"K-30000","name":"WEG Nebenstrasse","street":"Hauptstraße 7","postal_code":"01067","city":"Dresden"}
]$j$::jsonb);

SELECT is(
  (SELECT jsonb_agg(e->>'status' ORDER BY (e->>'row')::int) FROM res, jsonb_array_elements(r) e WHERE name = 'p1'),
  '["created","skipped","created","created"]'::jsonb,
  'an in-file duplicate of the same customer is skipped, other customers and addresses are created');
SELECT is((SELECT r->1->>'reason' FROM res WHERE name = 'p1'), 'property_exists',
  'the in-file duplicate has reason property_exists');
SELECT is((SELECT count(*)::int FROM werkbank.properties WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000e1'), 3,
  'three properties exist after the first import');

-- Re-import of the same file: every row is skipped, nothing is overwritten.
INSERT INTO res SELECT 'p2', werkbank.import_properties('bbbbbbbb-0000-4000-b000-0000000000e1', $j$[
  {"customer_no":"K-30000","name":"WEG Hauptstrasse neu","street":"Hauptstraße 5","postal_code":"01067","city":"Dresden"},
  {"customer_no":"K-30000","name":"WEG Hauptstrasse Kopie","street":"  hauptstraße   5 ","postal_code":" 01067","city":"DRESDEN "},
  {"customer_no":"K-30001","name":"WEG Hauptstrasse Zwei","street":"Hauptstraße 5","postal_code":"01067","city":"Dresden"},
  {"customer_no":"K-30000","name":"WEG Nebenstrasse","street":"Hauptstraße 7","postal_code":"01067","city":"Dresden"}
]$j$::jsonb);

SELECT is(
  (SELECT jsonb_agg(e->>'status' || '/' || (e->>'reason') ORDER BY (e->>'row')::int) FROM res, jsonb_array_elements(r) e WHERE name = 'p2'),
  '["skipped/property_exists","skipped/property_exists","skipped/property_exists","skipped/property_exists"]'::jsonb,
  're-importing the same file skips every row');
SELECT is((SELECT count(*)::int FROM werkbank.properties WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000e1'), 3,
  're-import creates no property');
SELECT is((SELECT count(*)::int FROM werkbank.properties WHERE name = 'WEG Hauptstrasse neu'), 0,
  'a skipped row does not overwrite the existing property');

-- An archived property still counts as existing.
RESET ROLE;
UPDATE werkbank.properties SET archived_at = now() WHERE name = 'WEG Nebenstrasse';
SET LOCAL ROLE authenticated;
INSERT INTO res SELECT 'p3', werkbank.import_properties('bbbbbbbb-0000-4000-b000-0000000000e1',
  '[{"customer_no":"K-30000","name":"WEG Nebenstrasse","street":"Hauptstrasse 7","postal_code":"01067","city":"Dresden"},
    {"customer_no":"K-30000","name":"WEG Nebenstrasse alt","street":"Hauptstraße 7","postal_code":"01067","city":"Dresden"}]'::jsonb);
SELECT is(
  (SELECT jsonb_agg(e->>'status' ORDER BY (e->>'row')::int) FROM res, jsonb_array_elements(r) e WHERE name = 'p3'),
  '["created","skipped"]'::jsonb,
  'a different spelling is a new address, an archived property with the same address is skipped');

-- The same customer number and address in another org is not a duplicate.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
INSERT INTO res SELECT 'p4', werkbank.import_properties('bbbbbbbb-0000-4000-b000-0000000000e2',
  '[{"customer_no":"K-30000","name":"WEG Hauptstrasse","street":"Hauptstraße 5","postal_code":"01067","city":"Dresden"}]'::jsonb);
SELECT is((SELECT r->0->>'status' FROM res WHERE name = 'p4'), 'created', 'a property in another org is not a duplicate');

-- Manual entry of a property with the same address stays possible.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e1');
SELECT lives_ok($$
  INSERT INTO werkbank.properties (org_id, customer_id, name, street, postal_code, city)
  SELECT org_id, id, 'WEG Hauptstrasse Hinterhaus', 'Hauptstraße 5', '01067', 'Dresden'
  FROM werkbank.customers WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000e1' AND customer_no = 'K-30000'
$$, 'manual entry of a property with the same address is still allowed');

SELECT * FROM finish();
ROLLBACK;
