-- Werkbank Teil 3 (R6): werkbank.record_quote_decision, the atomic decision on a quote.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(26);

SET session_replication_role = replica;
INSERT INTO public.organizations (id, name, slug, org_kind) VALUES
  ('bbbbbbbb-0000-4000-b000-0000000000f1','RQD Org','rqd-org','handwerk');
INSERT INTO werkbank.customers (id, org_id, customer_no, kind, last_name, street, postal_code, city) VALUES
  ('cccccccc-0000-4000-c000-0000000000f1','bbbbbbbb-0000-4000-b000-0000000000f1','K-1','private','Eins','Weg 1','01067','Dresden');
SET session_replication_role = DEFAULT;

-- Quotes as the edge function leaves them after send. f1 accept, f2 reject, f3 revoked,
-- f4 expired, f5 superseded, f6 stranded (an acceptance row exists although it is still sent),
-- f7 valid until today in Berlin.
SET LOCAL ROLE service_role;
INSERT INTO werkbank.quotes (id, org_id, quote_no, customer_id, valid_until, status, sent_at, sent_to, pdf_path, pdf_sha256, access_token_hash, link_revoked_at)
SELECT ('11111111-0000-4000-a000-0000000000f' || n)::uuid, 'bbbbbbbb-0000-4000-b000-0000000000f1', 'A-090' || n,
  'cccccccc-0000-4000-c000-0000000000f1',
  CASE n WHEN 4 THEN (now() AT TIME ZONE 'Europe/Berlin')::date - 1
         WHEN 7 THEN (now() AT TIME ZONE 'Europe/Berlin')::date
         ELSE (now() AT TIME ZONE 'Europe/Berlin')::date + 30 END,
  CASE n WHEN 5 THEN 'superseded' ELSE 'sent' END,
  now(), ARRAY['kunde@example.com'], 'org/quotes/q' || n || '.pdf', repeat(n::text, 64), 'hash-' || n,
  CASE n WHEN 3 THEN now() ELSE NULL END
FROM generate_series(1, 7) n;
INSERT INTO werkbank.quote_acceptances (org_id, quote_id, decision, signer_name, document_sha256)
  VALUES ('bbbbbbbb-0000-4000-b000-0000000000f1','11111111-0000-4000-a000-0000000000f6','rejected','Früher', repeat('6', 64));

CREATE OR REPLACE FUNCTION pg_temp.decide(_q text, _decision text, _pdf text) RETURNS text LANGUAGE sql AS $$
  SELECT werkbank.record_quote_decision(_q::uuid, _decision, 'Anna Muster',
    CASE WHEN _decision = 'accepted' THEN 'drawn' END, NULL,
    CASE WHEN _decision = 'accepted' THEN 'org/signatures/q-abc.png' END,
    '203.0.113.7', 'TestBrowser/1.0', CASE WHEN _decision = 'accepted' THEN 'Ich nehme an.' END,
    CASE WHEN _decision = 'rejected' THEN 'Zu teuer.' END, _pdf)
$$;
GRANT EXECUTE ON FUNCTION pg_temp.decide(text, text, text) TO PUBLIC;

CREATE OR REPLACE FUNCTION pg_temp.rows_for(_q text) RETURNS bigint LANGUAGE sql AS $$
  SELECT count(*) FROM werkbank.quote_acceptances WHERE quote_id = _q::uuid
$$;
GRANT EXECUTE ON FUNCTION pg_temp.rows_for(text) TO PUBLIC;

-- Accept ------------------------------------------------------------------------------
SELECT is(pg_temp.decide('11111111-0000-4000-a000-0000000000f1', 'accepted', 'org/quotes/q1-accepted-abc.pdf'), 'ok', 'accept returns ok');
SELECT is((SELECT status FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000f1'), 'accepted', 'accept sets status accepted');
SELECT is((SELECT accepted_pdf_path FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000f1'), 'org/quotes/q1-accepted-abc.pdf', 'accept stores accepted_pdf_path');
SELECT is(pg_temp.rows_for('11111111-0000-4000-a000-0000000000f1'), 1::bigint, 'accept inserts one acceptance row');
SELECT is((SELECT document_sha256 FROM werkbank.quote_acceptances WHERE quote_id = '11111111-0000-4000-a000-0000000000f1'), repeat('1', 64), 'document_sha256 is the quote''s pdf_sha256');
SELECT is((SELECT row(decision, signer_name, method, signature_image_path, ip, user_agent, consent_text, comment, org_id)::text
  FROM werkbank.quote_acceptances WHERE quote_id = '11111111-0000-4000-a000-0000000000f1'),
  row('accepted', 'Anna Muster', 'drawn', 'org/signatures/q-abc.png', '203.0.113.7', 'TestBrowser/1.0', 'Ich nehme an.', NULL::text, 'bbbbbbbb-0000-4000-b000-0000000000f1'::uuid)::text,
  'the acceptance row carries the evidence');
SELECT ok((SELECT decided_at IS NOT NULL FROM werkbank.quote_acceptances WHERE quote_id = '11111111-0000-4000-a000-0000000000f1'), 'decided_at is set');

-- A second decision -------------------------------------------------------------------
SELECT is(pg_temp.decide('11111111-0000-4000-a000-0000000000f1', 'rejected', NULL), 'decided', 'a second decision returns decided');
SELECT is(pg_temp.rows_for('11111111-0000-4000-a000-0000000000f1'), 1::bigint, 'still exactly one acceptance row');
SELECT is((SELECT status FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000f1'), 'accepted', 'the first decision stands');

-- Reject ------------------------------------------------------------------------------
SELECT is(pg_temp.decide('11111111-0000-4000-a000-0000000000f2', 'rejected', NULL), 'ok', 'reject returns ok');
SELECT is((SELECT status FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000f2'), 'rejected', 'reject sets status rejected');
SELECT is((SELECT accepted_pdf_path FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000f2'), NULL, 'reject stores no accepted PDF');
SELECT is((SELECT comment FROM werkbank.quote_acceptances WHERE quote_id = '11111111-0000-4000-a000-0000000000f2'), 'Zu teuer.', 'reject stores the comment');

-- Blocked states ----------------------------------------------------------------------
SELECT is(pg_temp.decide('11111111-0000-4000-a000-0000000000f3', 'accepted', 'p.pdf'), 'revoked', 'a revoked link returns revoked');
SELECT is(pg_temp.decide('11111111-0000-4000-a000-0000000000f4', 'accepted', 'p.pdf'), 'expired', 'valid until yesterday in Berlin returns expired');
SELECT is(pg_temp.decide('11111111-0000-4000-a000-0000000000f5', 'accepted', 'p.pdf'), 'superseded', 'a superseded quote returns superseded');
SELECT is((SELECT count(*) FROM werkbank.quote_acceptances WHERE quote_id IN (
  '11111111-0000-4000-a000-0000000000f3','11111111-0000-4000-a000-0000000000f4','11111111-0000-4000-a000-0000000000f5')), 0::bigint,
  'blocked states record no decision');
SELECT is((SELECT array_agg(status ORDER BY quote_no) FROM werkbank.quotes WHERE id IN (
  '11111111-0000-4000-a000-0000000000f3','11111111-0000-4000-a000-0000000000f4','11111111-0000-4000-a000-0000000000f5')),
  ARRAY['sent','sent','superseded'], 'blocked states change no status');
SELECT is(pg_temp.decide('99999999-0000-4000-a000-0000000000f9', 'accepted', 'p.pdf'), 'not_found', 'an unknown quote returns not_found');
SELECT is(pg_temp.decide('11111111-0000-4000-a000-0000000000f7', 'rejected', NULL), 'ok', 'valid until today in Berlin is still open');

-- Unique gate on a stranded row -------------------------------------------------------
SELECT is(pg_temp.decide('11111111-0000-4000-a000-0000000000f6', 'accepted', 'p.pdf'), 'decided', 'an existing acceptance row returns decided');
SELECT is((SELECT status FROM werkbank.quotes WHERE id = '11111111-0000-4000-a000-0000000000f6'), 'sent', 'and changes no status');

-- Input and privileges ----------------------------------------------------------------
SELECT throws_ok($$SELECT pg_temp.decide('11111111-0000-4000-a000-0000000000f2', 'accepted', NULL)$$,
  '22023', 'accepted_pdf_required', 'an accept needs the accepted PDF path');
RESET ROLE;
SELECT ok(NOT has_function_privilege('authenticated',
  'werkbank.record_quote_decision(uuid, text, text, text, text, text, text, text, text, text, text)', 'EXECUTE'),
  'authenticated cannot execute record_quote_decision');
SELECT ok(NOT has_function_privilege('anon',
  'werkbank.record_quote_decision(uuid, text, text, text, text, text, text, text, text, text, text)', 'EXECUTE'),
  'anon cannot execute record_quote_decision');

SELECT * FROM finish();
ROLLBACK;
