-- Werkbank Teil 3 (R6): the customer's decision on a quote, recorded atomically.
--
-- werkbank-quotes `decide` renders and uploads the accepted PDF (and the drawn signature) to
-- content-addressed paths first, then calls this function once. It locks the quote, re-checks the
-- link state, inserts the quote_acceptances row and sets the status in one transaction, so a
-- crash before the call leaves no decision behind and a crash after it leaves a complete one.
--
-- Returns 'ok' or the state that blocks the decision, checked in the order the public actions
-- use: 'not_found', 'superseded', 'revoked', 'decided', 'expired' (sent and valid_until before
-- today in Berlin). A unique violation on quote_acceptances.quote_id also yields 'decided'.
--
-- Service role only: the caller is an anonymous customer holding a link token, which the edge
-- function has already resolved to p_quote by its hash. There is no auth.uid() to check an org
-- role against, so execute is granted to service_role alone and revoked from everyone else.
create function werkbank.record_quote_decision(
  p_quote uuid,
  p_decision text,
  p_signer_name text,
  p_method text,
  p_typed_name text,
  p_signature_image_path text,
  p_ip text,
  p_user_agent text,
  p_consent_text text,
  p_comment text,
  p_accepted_pdf_path text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q werkbank.quotes;
begin
  if p_decision not in ('accepted', 'rejected') then
    raise exception 'invalid_decision' using errcode = '22023';
  end if;
  if p_decision = 'accepted' and p_accepted_pdf_path is null then
    raise exception 'accepted_pdf_required' using errcode = '22023';
  end if;

  select * into v_q from werkbank.quotes where id = p_quote for update;
  if not found then
    return 'not_found';
  end if;
  if v_q.status = 'superseded' then
    return 'superseded';
  end if;
  if v_q.link_revoked_at is not null then
    return 'revoked';
  end if;
  if v_q.status in ('accepted', 'rejected') then
    return 'decided';
  end if;
  if v_q.status <> 'sent' then
    return 'not_found';
  end if;
  if v_q.valid_until < (now() at time zone 'Europe/Berlin')::date then
    return 'expired';
  end if;

  begin
    insert into werkbank.quote_acceptances (org_id, quote_id, decision, comment, signer_name, method,
      typed_name, signature_image_path, decided_at, ip, user_agent, consent_text, document_sha256)
    values (v_q.org_id, v_q.id, p_decision, p_comment, p_signer_name, p_method,
      p_typed_name, p_signature_image_path, now(), p_ip, p_user_agent, p_consent_text, v_q.pdf_sha256);
  exception when unique_violation then
    return 'decided';
  end;

  update werkbank.quotes
  set status = p_decision,
    accepted_pdf_path = case when p_decision = 'accepted' then p_accepted_pdf_path else accepted_pdf_path end
  where id = v_q.id;

  return 'ok';
end;
$$;
revoke all on function werkbank.record_quote_decision(uuid, text, text, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function werkbank.record_quote_decision(uuid, text, text, text, text, text, text, text, text, text, text)
  to service_role;
