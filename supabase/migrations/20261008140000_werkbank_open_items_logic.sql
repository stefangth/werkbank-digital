-- Werkbank Teil 5 (R2): lock triggers on invoice_entries and dunning_notices, the open-amount helper
-- and the RPCs record_invoice_entry, reverse_invoice_entry, transfer_invoice_entry,
-- create_dunning_notice, set_dunning_hold, clear_dunning_hold.
-- Spec: docs/superpowers/specs/2026-10-08-werkbank-offene-posten-design.md (R1, R2).
--
-- Contexts as in 20261008110000: the user (`authenticated`, `anon`), the service role
-- (`service_role`, the edge function) and the owner context (the SECURITY DEFINER RPCs below and
-- every FK action). Every RPC checks the caller's org role (admin or producer of the invoice's org)
-- and locks the invoice row for update before it reads a balance or writes, so concurrent calls on
-- one invoice run one after the other. A foreign or unknown invoice or entry raises 42501
-- 'not allowed', as in finalize_invoice.

-- Entry lock --------------------------------------------------------------------------------------
-- Entries are written only in the owner context (the RPCs). They are never deleted, and the only
-- update is setting the three reversal columns once, from null, while the transaction-local setting
-- werkbank.entry_reversal is 'on' (set by reverse_invoice_entry and transfer_invoice_entry).
-- Everything else raises 55000 entries_locked. An org delete (the org row is already gone) passes.
create function werkbank.lock_invoice_entry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner boolean := current_user not in ('authenticated', 'anon', 'service_role');
  v_changed text[];
begin
  if tg_op = 'DELETE' then
    if v_owner and not exists (select 1 from public.organizations o where o.id = old.org_id) then
      return old;
    end if;
    raise exception 'entries_locked' using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    if not v_owner then
      raise exception 'entries_locked' using errcode = '55000';
    end if;
    return new;
  end if;

  v_changed := array(
    select n.key from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from to_jsonb(old) -> n.key);
  if not (v_owner
          and coalesce(current_setting('werkbank.entry_reversal', true), '') = 'on'
          and old.reversed_at is null and new.reversed_at is not null
          and v_changed <@ array['reversed_at', 'reversed_by', 'reversal_reason']) then
    raise exception 'entries_locked' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function werkbank.lock_invoice_entry() from public, anon;

create trigger invoice_entries_lock before insert or update or delete on werkbank.invoice_entries
  for each row execute function werkbank.lock_invoice_entry();

-- Notice lock -------------------------------------------------------------------------------------
-- Notices are inserted only in the owner context (create_dunning_notice) and never deleted. After
-- that only pdf_path and pdf_sha256 (once, from null) and sent_at and sent_to (any number of times,
-- once a file is stored) change, by the service role (the edge function) or the owner context.
-- Everything else raises 55000 dunning_locked. An org delete (the org row is already gone) passes.
create function werkbank.lock_dunning_notice()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner boolean := current_user not in ('authenticated', 'anon', 'service_role');
  v_service boolean := current_user = 'service_role';
  v_changed text[];
begin
  if tg_op = 'DELETE' then
    if v_owner and not exists (select 1 from public.organizations o where o.id = old.org_id) then
      return old;
    end if;
    raise exception 'dunning_locked' using errcode = '55000';
  end if;

  if tg_op = 'INSERT' then
    if not v_owner then
      raise exception 'dunning_locked' using errcode = '55000';
    end if;
    return new;
  end if;

  v_changed := array(
    select n.key from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from to_jsonb(old) -> n.key);
  if not (v_owner or v_service)
     or not (v_changed <@ array['pdf_path', 'pdf_sha256', 'sent_at', 'sent_to'])
     or (old.pdf_path is not null and new.pdf_path is distinct from old.pdf_path)
     or (old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256)
     or (v_changed && array['sent_at', 'sent_to'] and new.pdf_path is null) then
    raise exception 'dunning_locked' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function werkbank.lock_dunning_notice() from public, anon;

create trigger dunning_notices_lock before insert or update or delete on werkbank.dunning_notices
  for each row execute function werkbank.lock_dunning_notice();

-- Open amount ---------------------------------------------------------------------------------------
-- The one place of the balance rule: claim (gross_total of document_totals, 0 for a cancelled
-- invoice) minus non-reversed payments, plus non-reversed refunds, minus non-reversed write-offs.
-- Negative means credit. SECURITY INVOKER: called by the RPCs below it runs as their owner; called by
-- a user (directly or through the security_invoker view of the next migration) it sees only what RLS
-- shows that user, so another org's invoice yields null.
create function werkbank.invoice_open_amount(p_invoice uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case when i.status = 'cancelled' then 0 else coalesce(t.gross_total, 0) end
    - coalesce((
        select sum(case e.kind when 'refund' then -e.amount else e.amount end)
        from werkbank.invoice_entries e
        where e.invoice_id = i.id and e.reversed_at is null), 0)
  from werkbank.invoices i
  left join werkbank.document_totals t on t.invoice_id = i.id
  where i.id = p_invoice
$$;
revoke all on function werkbank.invoice_open_amount(uuid) from public, anon;
grant execute on function werkbank.invoice_open_amount(uuid) to authenticated;

-- Role check and row lock ---------------------------------------------------------------------------
-- Internal to the RPCs below (not callable by users). Checks that the caller is admin or producer of
-- p_invoice's org, then locks p_invoice and, when given and of the same org, p_other, in id order (so
-- two transfers in opposite directions cannot deadlock). Returns the locked p_invoice row.
create function werkbank.authorize_invoice(p_invoice uuid, p_other uuid default null)
returns werkbank.invoices
language plpgsql
set search_path = ''
as $$
declare
  v_org uuid;
  v_inv werkbank.invoices;
begin
  select i.org_id into v_org from werkbank.invoices i where i.id = p_invoice;
  if auth.uid() is null or not found
     or not (public.has_org_role(auth.uid(), v_org, 'admin') or public.has_org_role(auth.uid(), v_org, 'producer')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform 1 from werkbank.invoices i
  where i.id in (p_invoice, p_other) and i.org_id = v_org
  order by i.id
  for update;
  select * into v_inv from werkbank.invoices where id = p_invoice;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return v_inv;
end;
$$;
revoke all on function werkbank.authorize_invoice(uuid, uuid) from public, anon, authenticated;

-- RPCs ----------------------------------------------------------------------------------------------

-- Book a payment, refund or write-off. Checks in this order after the lock: kind, invoice state
-- (not_payable), amount precision (invalid_amount), booking date not after Berlin today
-- (future_booking_date), then per kind:
--   payment:   an issued invoice; any positive amount, above the open amount too (overpayment).
--   refund:    an issued or cancelled invoice; at most the current credit (refund_exceeds_credit).
--   write_off: an issued invoice with something open (nothing_open); p_amount must equal the open
--              amount recomputed here (open_amount_changed). Reason and note rules are table checks.
create function werkbank.record_invoice_entry(
  p_invoice uuid,
  p_kind text,
  p_amount numeric,
  p_booked_on date,
  p_note text default null,
  p_write_off_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv werkbank.invoices;
  v_open numeric;
  v_id uuid;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  v_inv := werkbank.authorize_invoice(p_invoice);
  if p_kind is null or p_kind not in ('payment', 'refund', 'write_off') then
    raise exception 'invalid_entry_kind' using errcode = '22023';
  end if;
  if v_inv.type <> 'invoice'
     or (v_inv.status <> 'issued' and not (p_kind = 'refund' and v_inv.status = 'cancelled')) then
    raise exception 'not_payable' using errcode = '22023';
  end if;
  if p_amount <> round(p_amount, 2) then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_booked_on > v_today then
    raise exception 'future_booking_date' using errcode = '22023';
  end if;

  v_open := werkbank.invoice_open_amount(p_invoice);
  if p_kind = 'refund' and p_amount > greatest(-v_open, 0) then
    raise exception 'refund_exceeds_credit' using errcode = '22023';
  end if;
  if p_kind = 'write_off' then
    if v_open <= 0 then
      raise exception 'nothing_open' using errcode = '22023';
    end if;
    if p_amount <> v_open then
      raise exception 'open_amount_changed' using errcode = '22023';
    end if;
  end if;

  insert into werkbank.invoice_entries (org_id, invoice_id, kind, amount, booked_on, write_off_reason, note, created_by)
  values (v_inv.org_id, v_inv.id, p_kind, p_amount, p_booked_on, p_write_off_reason, p_note, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function werkbank.record_invoice_entry(uuid, text, numeric, date, text, text) from public, anon;
grant execute on function werkbank.record_invoice_entry(uuid, text, numeric, date, text, text) to authenticated;

-- Reverse an entry once (already_reversed otherwise). The entry stays, struck through in the UI.
create function werkbank.reverse_invoice_entry(p_entry uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e werkbank.invoice_entries;
begin
  select * into v_e from werkbank.invoice_entries e where e.id = p_entry;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform werkbank.authorize_invoice(v_e.invoice_id);
  select * into v_e from werkbank.invoice_entries e where e.id = p_entry;
  if v_e.reversed_at is not null then
    raise exception 'already_reversed' using errcode = '22023';
  end if;

  perform set_config('werkbank.entry_reversal', 'on', true);
  update werkbank.invoice_entries
  set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = p_reason
  where id = p_entry;
  perform set_config('werkbank.entry_reversal', 'off', true);
end;
$$;
revoke all on function werkbank.reverse_invoice_entry(uuid, text) from public, anon;
grant execute on function werkbank.reverse_invoice_entry(uuid, text) to authenticated;

-- Move a non-reversed payment to another issued invoice of the same org and customer: reverse the
-- entry with p_reason and book a payment with the same amount, booked_on and note on the target,
-- transferred_from set. One transaction; a failure leaves both invoices untouched. The source may be
-- issued or cancelled (a payment on a cancelled invoice moves to its corrected copy). A refund or
-- write-off, or an invalid target, raises transfer_target_invalid.
create function werkbank.transfer_invoice_entry(p_entry uuid, p_target_invoice uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_e werkbank.invoice_entries;
  v_src werkbank.invoices;
  v_t werkbank.invoices;
  v_id uuid;
begin
  select * into v_e from werkbank.invoice_entries e where e.id = p_entry;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_src := werkbank.authorize_invoice(v_e.invoice_id, p_target_invoice);
  select * into v_e from werkbank.invoice_entries e where e.id = p_entry;
  if v_e.reversed_at is not null then
    raise exception 'already_reversed' using errcode = '22023';
  end if;
  if v_e.kind <> 'payment' then
    raise exception 'transfer_target_invalid' using errcode = '22023', detail = 'not_a_payment';
  end if;
  select * into v_t from werkbank.invoices i where i.id = p_target_invoice and i.org_id = v_src.org_id;
  if not found or v_t.id = v_src.id or v_t.type <> 'invoice' or v_t.status <> 'issued'
     or v_t.customer_id <> v_src.customer_id then
    raise exception 'transfer_target_invalid' using errcode = '22023';
  end if;

  perform set_config('werkbank.entry_reversal', 'on', true);
  update werkbank.invoice_entries
  set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = p_reason
  where id = p_entry;
  perform set_config('werkbank.entry_reversal', 'off', true);

  insert into werkbank.invoice_entries (org_id, invoice_id, kind, amount, booked_on, note, transferred_from, created_by)
  values (v_t.org_id, v_t.id, 'payment', v_e.amount, v_e.booked_on, v_e.note, v_e.id, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function werkbank.transfer_invoice_entry(uuid, uuid, text) from public, anon;
grant execute on function werkbank.transfer_invoice_entry(uuid, uuid, text) to authenticated;

-- Create the next notice (stage = highest existing + 1). Blockers are collected and raised once as
-- dunning_not_allowed, detail comma-separated in the order not_issued, not_overdue, nothing_open,
-- on_hold, previous_stage_open, max_stage. A hold counts while until is null or not before Berlin
-- today. The previous stage needs a stored file and, if delivered by email, a sent_at. The wait days
-- of the company profile are not enforced here (they only drive the dunning_due view). The amounts
-- are snapshotted: invoice_gross from document_totals, paid_amount = payments minus refunds,
-- open_amount from invoice_open_amount; notice_date is Berlin today.
create function werkbank.create_dunning_notice(p_invoice uuid, p_delivery text, p_payment_deadline date)
returns werkbank.dunning_notices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv werkbank.invoices;
  v_last werkbank.dunning_notices;
  v_open numeric;
  v_paid numeric;
  v_gross numeric;
  v_blockers text[] := array[]::text[];
  v_notice werkbank.dunning_notices;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  v_inv := werkbank.authorize_invoice(p_invoice);
  v_open := werkbank.invoice_open_amount(p_invoice);
  select * into v_last from werkbank.dunning_notices n where n.invoice_id = p_invoice order by n.stage desc limit 1;

  if v_inv.type <> 'invoice' or v_inv.status <> 'issued' then
    v_blockers := array_append(v_blockers, 'not_issued');
  end if;
  if v_inv.due_date is null or v_inv.due_date >= v_today then
    v_blockers := array_append(v_blockers, 'not_overdue');
  end if;
  if v_open <= 0 then
    v_blockers := array_append(v_blockers, 'nothing_open');
  end if;
  if exists (select 1 from werkbank.dunning_holds h
             where h.invoice_id = p_invoice and (h.until is null or h.until >= v_today)) then
    v_blockers := array_append(v_blockers, 'on_hold');
  end if;
  if v_last.id is not null and (v_last.pdf_path is null or (v_last.delivery = 'email' and v_last.sent_at is null)) then
    v_blockers := array_append(v_blockers, 'previous_stage_open');
  end if;
  if coalesce(v_last.stage, 0) >= 3 then
    v_blockers := array_append(v_blockers, 'max_stage');
  end if;
  if cardinality(v_blockers) > 0 then
    raise exception 'dunning_not_allowed' using errcode = '22023', detail = array_to_string(v_blockers, ',');
  end if;

  select t.gross_total into v_gross from werkbank.document_totals t where t.invoice_id = p_invoice;
  select coalesce(sum(case e.kind when 'refund' then -e.amount else e.amount end), 0) into v_paid
  from werkbank.invoice_entries e
  where e.invoice_id = p_invoice and e.kind in ('payment', 'refund') and e.reversed_at is null;

  insert into werkbank.dunning_notices (org_id, invoice_id, stage, notice_date, payment_deadline,
    invoice_gross, paid_amount, open_amount, delivery, created_by)
  values (v_inv.org_id, v_inv.id, coalesce(v_last.stage, 0) + 1, v_today, p_payment_deadline,
    coalesce(v_gross, 0), v_paid, v_open, p_delivery, auth.uid())
  returning * into v_notice;
  return v_notice;
end;
$$;
revoke all on function werkbank.create_dunning_notice(uuid, text, date) from public, anon;
grant execute on function werkbank.create_dunning_notice(uuid, text, date) to authenticated;

-- Put an invoice on hold (insert or replace the hold) and lift it (delete the row; a hold is a
-- working note, not a business record). A blank reason fails on the table check (23514).
create function werkbank.set_dunning_hold(p_invoice uuid, p_reason text, p_until date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv werkbank.invoices;
begin
  v_inv := werkbank.authorize_invoice(p_invoice);
  insert into werkbank.dunning_holds (invoice_id, org_id, reason, until, created_by)
  values (v_inv.id, v_inv.org_id, p_reason, p_until, auth.uid())
  on conflict (invoice_id) do update
  set reason = excluded.reason, until = excluded.until, created_by = excluded.created_by, created_at = now();
end;
$$;
revoke all on function werkbank.set_dunning_hold(uuid, text, date) from public, anon;
grant execute on function werkbank.set_dunning_hold(uuid, text, date) to authenticated;

create function werkbank.clear_dunning_hold(p_invoice uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform werkbank.authorize_invoice(p_invoice);
  delete from werkbank.dunning_holds h where h.invoice_id = p_invoice;
end;
$$;
revoke all on function werkbank.clear_dunning_hold(uuid) from public, anon;
grant execute on function werkbank.clear_dunning_hold(uuid) to authenticated;
