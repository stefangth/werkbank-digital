-- Werkbank Teil 2: master data tables (customers, properties, contacts, catalog_items), RLS and checks.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(74);

SET session_replication_role = replica;
INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
VALUES
  ('aaaaaaaa-0000-4000-a000-0000000000e1','authenticated','authenticated','md-admin-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000e2','authenticated','authenticated','md-producer-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000e3','authenticated','authenticated','md-artist-a@test.com',now(),'{"provider":"email"}','{}',now(),now()),
  ('aaaaaaaa-0000-4000-a000-0000000000e4','authenticated','authenticated','md-admin-b@test.com',now(),'{"provider":"email"}','{}',now(),now());
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000e1','MD Org A','md-org-a','handwerk'),
  ('bbbbbbbb-0000-4000-b000-0000000000e2','MD Org B','md-org-b','handwerk');
INSERT INTO public.org_memberships (org_id, user_id, role) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000e1','aaaaaaaa-0000-4000-a000-0000000000e1','admin'),
  ('bbbbbbbb-0000-4000-b000-0000000000e1','aaaaaaaa-0000-4000-a000-0000000000e2','producer'),
  ('bbbbbbbb-0000-4000-b000-0000000000e1','aaaaaaaa-0000-4000-a000-0000000000e3','artist'),
  ('bbbbbbbb-0000-4000-b000-0000000000e2','aaaaaaaa-0000-4000-a000-0000000000e4','admin');
SET session_replication_role = DEFAULT;

CREATE OR REPLACE FUNCTION pg_temp.act_as(_uid text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
END $$;

CREATE OR REPLACE FUNCTION pg_temp.del_count(_tbl text, _where text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE format('WITH d AS (DELETE FROM %s WHERE %s RETURNING 1) SELECT count(*)::int FROM d', _tbl, _where) INTO n;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.del_count(text, text) TO PUBLIC;

-- Tables exist and RLS is on.
SELECT has_table('werkbank', 'customers', 'customers exists');
SELECT has_table('werkbank', 'properties', 'properties exists');
SELECT has_table('werkbank', 'contacts', 'contacts exists');
SELECT has_table('werkbank', 'catalog_items', 'catalog_items exists');
SELECT is(
  (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'werkbank' AND c.relname IN ('customers','properties','contacts','catalog_items') AND c.relrowsecurity),
  4, 'RLS is enabled on all four tables');

-- Admin A: full write access in org A.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e1');
SET LOCAL ROLE authenticated;
SELECT lives_ok($$INSERT INTO werkbank.customers (id, org_id, customer_no, kind, company_name, street, postal_code, city)
  VALUES ('cccccccc-0000-4000-c000-0000000000a1','bbbbbbbb-0000-4000-b000-0000000000e1','K-1','property_manager','Hausverwaltung Nord','Hauptstr. 1','01067','Dresden')$$,
  'admin A inserts a customer');
SELECT lives_ok($$INSERT INTO werkbank.properties (id, org_id, customer_id, name, street, postal_code, city)
  VALUES ('dddddddd-0000-4000-d000-0000000000a1','bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000a1','WEG Musterstr. 5','Musterstr. 5','01067','Dresden')$$,
  'admin A inserts a property');
SELECT lives_ok($$INSERT INTO werkbank.contacts (id, org_id, customer_id, last_name, is_primary)
  VALUES ('eeeeeeee-0000-4000-e000-0000000000a1','bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000a1','Meier',true)$$,
  'admin A inserts a contact');
SELECT lives_ok($$INSERT INTO werkbank.catalog_items (id, org_id, item_no, name, unit_code, labour_price, material_price)
  VALUES ('ffffffff-0000-4000-f000-0000000000a1','bbbbbbbb-0000-4000-b000-0000000000e1','A-1','Rohr tauschen','H87',40.00,12.50)$$,
  'admin A inserts a catalog item');
SELECT is((SELECT count(*)::int FROM werkbank.customers), 1, 'admin A sees the customer');
SELECT is((SELECT count(*)::int FROM werkbank.properties), 1, 'admin A sees the property');
SELECT is((SELECT count(*)::int FROM werkbank.contacts), 1, 'admin A sees the contact');
SELECT is((SELECT count(*)::int FROM werkbank.catalog_items), 1, 'admin A sees the catalog item');
SELECT is((SELECT net_price FROM werkbank.catalog_items WHERE id = 'ffffffff-0000-4000-f000-0000000000a1'),
  52.50::numeric, 'net_price is labour_price + material_price');
RESET ROLE;

-- Producer A: read and write, limited delete.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e2');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.customers), 1, 'producer A sees the customer');
SELECT is((SELECT count(*)::int FROM werkbank.properties), 1, 'producer A sees the property');
SELECT is((SELECT count(*)::int FROM werkbank.contacts), 1, 'producer A sees the contact');
SELECT is((SELECT count(*)::int FROM werkbank.catalog_items), 1, 'producer A sees the catalog item');
SELECT lives_ok($$INSERT INTO werkbank.customers (org_id, customer_no, kind, last_name, street, postal_code, city)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','K-2','private','Schmidt','Gasse 2','80331','München')$$,
  'producer A inserts a customer');
SELECT lives_ok($$INSERT INTO werkbank.properties (org_id, customer_id, name, street, postal_code, city)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000a1','Objekt 2','Weg 2','01067','Dresden')$$,
  'producer A inserts a property');
SELECT lives_ok($$INSERT INTO werkbank.contacts (org_id, property_id, last_name)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','dddddddd-0000-4000-d000-0000000000a1','Hausmeister')$$,
  'producer A inserts a contact');
SELECT lives_ok($$INSERT INTO werkbank.catalog_items (org_id, name, unit_code)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','Anfahrt','LS')$$,
  'producer A inserts a catalog item');
SELECT lives_ok($$UPDATE werkbank.customers SET notes = 'x' WHERE id = 'cccccccc-0000-4000-c000-0000000000a1'$$,
  'producer A updates a customer');
SELECT is(pg_temp.del_count('werkbank.properties', $q$id = 'dddddddd-0000-4000-d000-0000000000a1'$q$),
  0, 'producer A deleting a property affects 0 rows');
SELECT is(pg_temp.del_count('werkbank.catalog_items', $q$id = 'ffffffff-0000-4000-f000-0000000000a1'$q$),
  0, 'producer A deleting a catalog item affects 0 rows');
SELECT is(pg_temp.del_count('werkbank.customers', $q$id = 'cccccccc-0000-4000-c000-0000000000a1'$q$),
  0, 'producer A deleting a customer affects 0 rows');
SELECT is(pg_temp.del_count('werkbank.contacts', $q$id = 'eeeeeeee-0000-4000-e000-0000000000a1'$q$),
  1, 'producer A can delete a contact');
RESET ROLE;

-- Artist A: nothing.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e3');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.customers), 0, 'artist A sees no customers');
SELECT is((SELECT count(*)::int FROM werkbank.properties), 0, 'artist A sees no properties');
SELECT is((SELECT count(*)::int FROM werkbank.contacts), 0, 'artist A sees no contacts');
SELECT is((SELECT count(*)::int FROM werkbank.catalog_items), 0, 'artist A sees no catalog items');
SELECT throws_ok($$INSERT INTO werkbank.customers (org_id, customer_no, kind, last_name, street, postal_code, city)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','K-9','private','X','Gasse 2','80331','München')$$,
  '42501', NULL, 'artist A cannot insert a customer');
SELECT throws_ok($$INSERT INTO werkbank.properties (org_id, customer_id, name, street, postal_code, city)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000a1','X','Weg 2','01067','Dresden')$$,
  '42501', NULL, 'artist A cannot insert a property');
SELECT throws_ok($$INSERT INTO werkbank.contacts (org_id, customer_id, last_name)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000a1','X')$$,
  '42501', NULL, 'artist A cannot insert a contact');
SELECT throws_ok($$INSERT INTO werkbank.catalog_items (org_id, name, unit_code)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','X','LS')$$,
  '42501', NULL, 'artist A cannot insert a catalog item');
RESET ROLE;

-- Admin B: sees nothing of org A, cannot cross-link.
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e4');
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::int FROM werkbank.customers), 0, 'admin B sees no customers of org A');
SELECT is((SELECT count(*)::int FROM werkbank.properties), 0, 'admin B sees no properties of org A');
SELECT is((SELECT count(*)::int FROM werkbank.contacts), 0, 'admin B sees no contacts of org A');
SELECT is((SELECT count(*)::int FROM werkbank.catalog_items), 0, 'admin B sees no catalog items of org A');
SELECT throws_ok($$INSERT INTO werkbank.properties (org_id, customer_id, name, street, postal_code, city)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e2','cccccccc-0000-4000-c000-0000000000a1','Cross','Weg 2','01067','Dresden')$$,
  '23503', NULL, 'a property in org B cannot point at a customer of org A');
RESET ROLE;

-- Check constraints (admin A).
SELECT pg_temp.act_as('aaaaaaaa-0000-4000-a000-0000000000e1');
SET LOCAL ROLE authenticated;
SELECT throws_ok($$INSERT INTO werkbank.customers (org_id, customer_no, kind, street, postal_code, city)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','K-c1','property_manager','S 1','01067','Dresden')$$,
  '23514', NULL, 'a property manager needs a company name');
SELECT throws_ok($$INSERT INTO werkbank.customers (org_id, customer_no, kind, first_name, street, postal_code, city)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','K-c2','private','Anna','S 1','01067','Dresden')$$,
  '23514', NULL, 'a private customer needs a last name');
SELECT throws_ok($$INSERT INTO werkbank.customers (org_id, customer_no, kind, last_name, street, postal_code, city)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','K-c3','private','A','S 1','1067','Dresden')$$,
  '23514', NULL, 'postal code 1067 is rejected for DE');
SELECT throws_ok($$INSERT INTO werkbank.customers (org_id, customer_no, kind, last_name, street, postal_code, city, country_code)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','K-c4','private','A','S 1','01067','Dresden','de')$$,
  '23514', NULL, 'lowercase country code is rejected');
SELECT throws_ok($$INSERT INTO werkbank.customers (org_id, customer_no, kind, last_name, street, postal_code, city, email)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','K-c5','private','A','S 1','01067','Dresden','foo')$$,
  '23514', NULL, 'an invalid email is rejected');
SELECT throws_ok($$INSERT INTO werkbank.customers (org_id, customer_no, kind, last_name, street, postal_code, city, payment_terms_days)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','K-c6','private','A','S 1','01067','Dresden',400)$$,
  '23514', NULL, 'payment terms of 400 days are rejected');
SELECT throws_ok($$INSERT INTO werkbank.customers (org_id, customer_no, kind, last_name, street, postal_code, city, vat_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','K-c7','private','A','S 1','01067','Dresden','x')$$,
  '23514', NULL, 'an invalid VAT id is rejected');
SELECT lives_ok($$INSERT INTO werkbank.customers (org_id, customer_no, kind, last_name, street, postal_code, city, country_code, vat_id)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','K-c8','private','A','S 1','1010','Wien','AT','ATU12345678')$$,
  'a non-DE country accepts postal code 1010');
SELECT throws_ok($$INSERT INTO werkbank.catalog_items (org_id, name, unit_code, vat_rate)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','X','LS',16)$$,
  '23514', NULL, 'vat rate 16 is rejected');
SELECT throws_ok($$INSERT INTO werkbank.catalog_items (org_id, name, unit_code)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','X','XYZ')$$,
  '23514', NULL, 'unit code XYZ is rejected');
SELECT throws_ok($$INSERT INTO werkbank.catalog_items (org_id, name, unit_code, labour_price)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','X','LS',-1)$$,
  '23514', NULL, 'a negative labour price is rejected');
SELECT throws_ok($$INSERT INTO werkbank.properties (org_id, customer_id, name, street, postal_code, city, billing_name)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000a1','X','S 1','01067','Dresden','Rechnung GmbH')$$,
  '23514', NULL, 'billing_name without the billing address is rejected');
SELECT lives_ok($$INSERT INTO werkbank.properties (org_id, customer_id, name, street, postal_code, city, billing_name, billing_street, billing_postal_code, billing_city, billing_country_code)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000a1','Y','S 1','01067','Dresden','Rechnung GmbH','R 1','80331','München','DE')$$,
  'a full billing address is accepted');
SELECT throws_ok($$INSERT INTO werkbank.properties (org_id, customer_id, name, street, postal_code, city, billing_name, billing_street, billing_postal_code, billing_city, billing_country_code)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000a1','Z','S 1','01067','Dresden','Rechnung GmbH','R 1','803','München','DE')$$,
  '23514', NULL, 'a DE billing postal code needs five digits');
SELECT throws_ok($$INSERT INTO werkbank.contacts (org_id, customer_id, property_id, last_name)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000a1','dddddddd-0000-4000-d000-0000000000a1','Both')$$,
  '23514', NULL, 'a contact with both parents is rejected');
SELECT throws_ok($$INSERT INTO werkbank.contacts (org_id, last_name)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','Neither')$$,
  '23514', NULL, 'a contact with no parent is rejected');
SELECT throws_ok($$INSERT INTO werkbank.contacts (org_id, customer_id, last_name, email)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000a1','Mail','foo')$$,
  '23514', NULL, 'a contact with an invalid email is rejected');

-- Uniqueness.
SELECT throws_ok($$INSERT INTO werkbank.customers (org_id, customer_no, kind, last_name, street, postal_code, city)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','K-1','private','Dup','S 1','01067','Dresden')$$,
  '23505', NULL, 'a duplicate customer number is rejected');
SELECT throws_ok($$INSERT INTO werkbank.catalog_items (org_id, item_no, name, unit_code)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','A-1','Dup','LS')$$,
  '23505', NULL, 'a duplicate item number is rejected');
SELECT lives_ok($$INSERT INTO werkbank.catalog_items (org_id, name, unit_code)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','NoNo','LS'), ('bbbbbbbb-0000-4000-b000-0000000000e1','NoNo2','LS')$$,
  'catalog items without an item number do not collide');
SELECT lives_ok($$INSERT INTO werkbank.contacts (org_id, customer_id, last_name, is_primary)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000a1','Erste',true)$$,
  'a primary contact is accepted');
SELECT throws_ok($$INSERT INTO werkbank.contacts (org_id, customer_id, last_name, is_primary)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000a1','Zweite',true)$$,
  '23505', NULL, 'a second primary contact on the customer is rejected');
SELECT lives_ok($$INSERT INTO werkbank.contacts (org_id, property_id, last_name, is_primary)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','dddddddd-0000-4000-d000-0000000000a1','P1',true)$$,
  'a primary contact on a property is accepted');
SELECT throws_ok($$INSERT INTO werkbank.contacts (org_id, property_id, last_name, is_primary)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','dddddddd-0000-4000-d000-0000000000a1','P2',true)$$,
  '23505', NULL, 'a second primary contact on the property is rejected');

-- Deletes (admin A).
SELECT throws_ok($$DELETE FROM werkbank.customers WHERE id = 'cccccccc-0000-4000-c000-0000000000a1'$$,
  '23503', NULL, 'deleting a customer that has a property throws 23503');
SELECT lives_ok($$INSERT INTO werkbank.customers (id, org_id, customer_no, kind, last_name, street, postal_code, city)
  VALUES ('cccccccc-0000-4000-c000-0000000000a2','bbbbbbbb-0000-4000-b000-0000000000e1','K-d1','private','Solo','S 1','01067','Dresden')$$,
  'admin A inserts a customer without a property');
SELECT lives_ok($$INSERT INTO werkbank.contacts (org_id, customer_id, last_name)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000e1','cccccccc-0000-4000-c000-0000000000a2','Kontakt')$$,
  'admin A inserts a contact on that customer');
SELECT is(pg_temp.del_count('werkbank.customers', $q$id = 'cccccccc-0000-4000-c000-0000000000a2'$q$),
  1, 'admin A deletes a customer that only has contacts');
SELECT is((SELECT count(*)::int FROM werkbank.contacts WHERE customer_id = 'cccccccc-0000-4000-c000-0000000000a2'),
  0, 'the contacts went with the customer');
SELECT is(pg_temp.del_count('werkbank.catalog_items', $q$name = 'NoNo'$q$),
  1, 'admin A deletes a catalog item');
RESET ROLE;

-- Org delete cascades to all four tables.
DELETE FROM public.organizations WHERE id = 'bbbbbbbb-0000-4000-b000-0000000000e1';
SELECT is((SELECT count(*)::int FROM werkbank.customers WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000e1'), 0, 'org delete removes customers');
SELECT is((SELECT count(*)::int FROM werkbank.properties WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000e1'), 0, 'org delete removes properties');
SELECT is((SELECT count(*)::int FROM werkbank.contacts WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000e1'), 0, 'org delete removes contacts');
SELECT is((SELECT count(*)::int FROM werkbank.catalog_items WHERE org_id = 'bbbbbbbb-0000-4000-b000-0000000000e1'), 0, 'org delete removes catalog items');

SELECT * FROM finish();
ROLLBACK;
