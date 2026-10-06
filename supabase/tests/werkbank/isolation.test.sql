-- Werkbank isolation: the plugin lives in its own schema so that removal is
-- `drop schema werkbank cascade`. That only stays safe while nothing in `public`
-- depends on an object in `werkbank`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

SELECT has_schema('werkbank', 'werkbank schema exists');

-- Every pg_depend edge from an object living in `public` to an object living in `werkbank`.
-- Dependents are resolved per catalog: relations (tables, views), functions, view
-- rewrite rules (the rule's view lives in ev_class), column defaults, constraints,
-- triggers and policies (each owned by a table).
CREATE FUNCTION pg_temp.public_to_werkbank_deps() RETURNS SETOF text
LANGUAGE sql STABLE AS $$
  SELECT pg_describe_object(d.classid, d.objid, d.objsubid) || ' -> '
         || pg_describe_object(d.refclassid, d.refobjid, d.refobjsubid)
  FROM pg_depend d
  WHERE d.deptype IN ('n', 'a')
    AND (pg_identify_object(d.refclassid, d.refobjid, 0)).schema = 'werkbank'
    AND CASE d.classid
      WHEN 'pg_class'::regclass THEN
        (SELECT c.relnamespace FROM pg_class c WHERE c.oid = d.objid) = 'public'::regnamespace
      WHEN 'pg_proc'::regclass THEN
        (SELECT p.pronamespace FROM pg_proc p WHERE p.oid = d.objid) = 'public'::regnamespace
      WHEN 'pg_rewrite'::regclass THEN
        (SELECT c.relnamespace FROM pg_rewrite r JOIN pg_class c ON c.oid = r.ev_class
          WHERE r.oid = d.objid) = 'public'::regnamespace
      WHEN 'pg_attrdef'::regclass THEN
        (SELECT c.relnamespace FROM pg_attrdef a JOIN pg_class c ON c.oid = a.adrelid
          WHERE a.oid = d.objid) = 'public'::regnamespace
      WHEN 'pg_constraint'::regclass THEN
        (SELECT k.connamespace FROM pg_constraint k WHERE k.oid = d.objid) = 'public'::regnamespace
      WHEN 'pg_trigger'::regclass THEN
        (SELECT c.relnamespace FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE t.oid = d.objid) = 'public'::regnamespace
      WHEN 'pg_policy'::regclass THEN
        (SELECT c.relnamespace FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
          WHERE p.oid = d.objid) = 'public'::regnamespace
      ELSE false
    END
$$;

-- Prove the detector works: a public view over a werkbank table is a violation.
CREATE TABLE werkbank.t (id int);
CREATE VIEW public.werkbank_isolation_probe AS SELECT id FROM werkbank.t;
SELECT isnt_empty(
  $$ SELECT * FROM pg_temp.public_to_werkbank_deps() $$,
  'detector finds a public view that depends on a werkbank table');
DROP VIEW public.werkbank_isolation_probe;
DROP TABLE werkbank.t;

-- Same detector, function flavour: a SQL-standard function body records its table
-- dependencies (a quoted body would not), so this is a pg_proc violation.
CREATE TABLE werkbank.t (id int);
CREATE FUNCTION public.werkbank_isolation_probe() RETURNS bigint
LANGUAGE sql BEGIN ATOMIC SELECT count(*) FROM werkbank.t; END;
SELECT isnt_empty(
  $$ SELECT * FROM pg_temp.public_to_werkbank_deps() $$,
  'detector finds a public function that depends on a werkbank table');
DROP FUNCTION public.werkbank_isolation_probe();
DROP TABLE werkbank.t;

SELECT is_empty(
  $$ SELECT * FROM pg_temp.public_to_werkbank_deps() $$,
  'no object in public depends on an object in werkbank');

SELECT * FROM finish();
ROLLBACK;
