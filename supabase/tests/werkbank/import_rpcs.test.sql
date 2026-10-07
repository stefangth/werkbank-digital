-- Werkbank Teil 2: import RPCs (import_customers, import_properties, import_catalog_items).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(30);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000d1','authenticated','authenticated','im-admin-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000d2','authenticated','authenticated','im-producer-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000d3','authenticated','authenticated','im-artist-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000d4','authenticated','authenticated','im-admin-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000d1','IM Org A','im-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000d2','IM Org B','im-org-b','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000d3','IM Org C','im-org-c','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000d1','aaaaaaaa-0000-4000-a000-0000000000d1','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000000d1','aaaaaaaa-0000-4000-a000-0000000000d2','producer'),
  ('bbbbbbbb-0000-4000-b000-0000000000d1','aaaaaaaa-0000-4000-a000-0000000000d3','artist'),
  ('bbbbbbbb-0000-4000-b000-0000000000d2','aaaaaaaa-0000-4000-a000-0000000000d4','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000000d3','aaaaaaaa-0000-4000-a000-0000000000d2','producer');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

CREATE TEMP TABLE res (name text PRIMARY KEY, r jsonb);
GRANT ALL ON res TO PUBLIC;

-- Customers: explicit number, automatic number, invalid row (Hausverwaltung without company name).
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000d2');
SET LOCAL ROLE authenticated;
INSERT INTO res SELECT 'c1', werkbank.import_customers('bbbbbbbb-0000-4000-b000-0000000000d1', $j$[
  {"customer_no":"K-20000","kind":"property_manager","company_name":"Import Nord","street":"A 1","postal_code":"01067","city":"Dresden",
   "org_id":"bbbbbbbb-0000-4000-b000-0000000000d2","id":"11111111-1111-4111-8111-111111111111","archived_at":"2020-01-01T00:00:00Z","bogus":"ignored"},
  {"kind":"private","last_name":"Schmidt","street":"B 2","postal_code":"01069","city":"Dresden"},
  {"kind":"property_manager","street":"C 3","postal_code":"01069","city":"Dresden"}
]$j$::jsonb);

SELECT is(
  (SELECT jsonb_agg(e->>'status' ORDER BY (e->>'row')::int) FROM res, jsonb_array_elements(r) e WHERE name = 'c1'),
  '["created","created","error"]'::jsonb, 'customer import: created, created, error');
SELECT is((SELECT r->2->>'reason' FROM res WHERE name = 'c1'), 'invalid', 'invalid row has reason invalid');
SELECT is((SELECT r->2->>'detail' FROM res WHERE name = 'c1'), 'customers_company_name_required',
  'invalid row detail names the failing check');
SELECT is((SELECT (r->2->>'row')::int FROM res WHERE name = 'c1'), 2, 'result carries the 0-based row index');

SELECT is((SELECT count(*)::int FROM werkbank.customers WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000d1'), 2,
  'two customers exist in org A');
SELECT is((SELECT count(*)::int FROM werkbank.customers WHERE id = '11111111-1111-4111-8111-111111111111'), 0,
  'id from the JSON is ignored');
SELECT is((SELECT org_id FROM werkbank.customers WHERE customer_no = 'K-20000'), 'bbbbbbbb-0000-4000-b000-0000000000d1'::uuid,
  'org_id from the JSON is ignored');
SELECT is((SELECT archived_at FROM werkbank.customers WHERE customer_no = 'K-20000'), NULL::timestamptz,
  'archived_at from the JSON is ignored');
SELECT is((SELECT country_code || ':' || payment_terms_days FROM werkbank.customers WHERE last_name = 'Schmidt'), 'DE:14',
  'column defaults apply to omitted keys');
SELECT is((SELECT customer_no FROM werkbank.customers WHERE last_name = 'Schmidt'), 'K-20001',
  'a row without customer_no gets an automatic number');
SELECT is((SELECT next_value FROM werkbank.number_ranges WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000d1' AND key = 'customer'),
  20002::bigint, 'range is raised above the highest imported number');

INSERT INTO werkbank.customers (org_id, kind, last_name, street, postal_code, city)
VALUES ('bbbbbbbb-0000-4000-b000-0000000000d1', 'private', 'Neu', 'D 4', '01069', 'Dresden');
SELECT is((SELECT customer_no FROM werkbank.customers WHERE last_name = 'Neu'), 'K-20002', 'the next new customer gets K-20002');

-- Re-import of an existing number is skipped and leaves the row unchanged.
INSERT INTO res SELECT 'c2', werkbank.import_customers('bbbbbbbb-0000-4000-b000-0000000000d1',
  '[{"customer_no":"K-20000","kind":"property_manager","company_name":"Overwritten","street":"A 1","postal_code":"01067","city":"Dresden"}]'::jsonb);
SELECT is((SELECT r->0->>'status' || '/' || (r->0->>'reason') FROM res WHERE name = 'c2'), 'skipped/customer_no_taken',
  're-import of K-20000 is skipped');
SELECT is((SELECT company_name FROM werkbank.customers WHERE customer_no = 'K-20000'), 'Import Nord', 'skipped row is unchanged');

-- A number outside the prefix pattern leaves the range alone.
INSERT INTO res SELECT 'c3', werkbank.import_customers('bbbbbbbb-0000-4000-b000-0000000000d1',
  '[{"customer_no":"ALT-7","kind":"private","last_name":"Alt","street":"E 5","postal_code":"01069","city":"Dresden"}]'::jsonb);
SELECT is((SELECT r->0->>'status' FROM res WHERE name = 'c3'), 'created', 'ALT-7 is created');
SELECT is((SELECT next_value FROM werkbank.number_ranges WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000d1' AND key = 'customer'),
  20003::bigint, 'ALT-7 leaves next_value unchanged');

-- Fresh org without customers or range row: numberless rows after an explicit K-10001 must not collide.
INSERT INTO res SELECT 'c4', werkbank.import_customers('bbbbbbbb-0000-4000-b000-0000000000d3', $j$[
  {"customer_no":"K-10001","kind":"private","last_name":"Eins","street":"A 1","postal_code":"01069","city":"Dresden"},
  {"kind":"private","last_name":"Zwei","street":"A 2","postal_code":"01069","city":"Dresden"},
  {"kind":"private","last_name":"Drei","street":"A 3","postal_code":"01069","city":"Dresden"}
]$j$::jsonb);
SELECT is((SELECT jsonb_agg(e->>'status' ORDER BY (e->>'row')::int) FROM res, jsonb_array_elements(r) e WHERE name = 'c4'),
  '["created","created","created"]'::jsonb, 'numberless rows after an explicit K-10001 are created');
SELECT is((SELECT string_agg(customer_no, ',' ORDER BY customer_no) FROM werkbank.customers WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000d3'),
  'K-10001,K-10002,K-10003', 'generated numbers continue after the explicit one');

-- Properties.
INSERT INTO res SELECT 'p1', werkbank.import_properties('bbbbbbbb-0000-4000-b000-0000000000d1', $j$[
  {"customer_no":"K-20000","name":"WEG Import 1","street":"F 6","postal_code":"01067","city":"Dresden","org_id":"bbbbbbbb-0000-4000-b000-0000000000d2"},
  {"customer_no":"K-99999","name":"WEG Unbekannt","street":"G 7","postal_code":"01067","city":"Dresden"},
  {"customer_no":"K-20000","name":"WEG Kaputt","street":"H 8","postal_code":"1067","city":"Dresden"}
]$j$::jsonb);
SELECT is((SELECT r->0->>'status' FROM res WHERE name = 'p1'), 'created', 'property with a known customer_no is created');
SELECT is((SELECT r->1->>'status' || '/' || (r->1->>'reason') FROM res WHERE name = 'p1'), 'error/unknown_customer',
  'property with an unknown customer_no is an error');
SELECT is((SELECT r->2->>'detail' FROM res WHERE name = 'p1'), 'properties_de_postal_code',
  'property check violation is reported as invalid with the constraint name');
SELECT is((SELECT p.org_id || ':' || c.customer_no FROM werkbank.properties p JOIN werkbank.customers c ON c.id = p.customer_id
  WHERE p.name = 'WEG Import 1'), 'bbbbbbbb-0000-4000-b000-0000000000d1:K-20000', 'property is linked to the customer of org A');

-- Catalog.
INSERT INTO res SELECT 'k1', werkbank.import_catalog_items('bbbbbbbb-0000-4000-b000-0000000000d1', $j$[
  {"item_no":"I-1","name":"Rohr","unit_code":"H87","labour_price":10,"material_price":2.5,"net_price":999},
  {"item_no":"I-1","name":"Rohr doppelt","unit_code":"H87"},
  {"item_no":"I-2","name":"Falsch","unit_code":"XYZ"}
]$j$::jsonb);
SELECT is((SELECT jsonb_agg(e->>'status' ORDER BY (e->>'row')::int) FROM res, jsonb_array_elements(r) e WHERE name = 'k1'),
  '["created","skipped","error"]'::jsonb, 'catalog import: created, skipped, error');
SELECT is((SELECT r->1->>'reason' FROM res WHERE name = 'k1'), 'item_no_taken', 'duplicate item_no is item_no_taken');
SELECT is((SELECT r->2->>'reason' FROM res WHERE name = 'k1'), 'invalid', 'unknown unit_code is invalid');
SELECT is((SELECT net_price FROM werkbank.catalog_items WHERE item_no = 'I-1'), 12.50, 'net_price from the JSON is ignored');

-- Roles: artist of A and admin of B are rejected.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000d3');
SELECT throws_ok($$SELECT werkbank.import_customers('bbbbbbbb-0000-4000-b000-0000000000d1', '[]'::jsonb)$$, '42501', NULL, 'artist cannot import customers');
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000d4');
SELECT throws_ok($$SELECT werkbank.import_customers('bbbbbbbb-0000-4000-b000-0000000000d1', '[]'::jsonb)$$, '42501', NULL, 'admin of B cannot import customers into A');
SELECT throws_ok($$SELECT werkbank.import_properties('bbbbbbbb-0000-4000-b000-0000000000d1', '[]'::jsonb)$$, '42501', NULL, 'admin of B cannot import properties into A');
SELECT throws_ok($$SELECT werkbank.import_catalog_items('bbbbbbbb-0000-4000-b000-0000000000d1', '[]'::jsonb)$$, '42501', NULL, 'admin of B cannot import catalog items into A');

SELECT * FROM finish();
ROLLBACK;
