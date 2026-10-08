-- Werkbank Teil 5, final review fixes (ruling R12 of the final review).
-- Spec: docs/superpowers/specs/2026-10-08-werkbank-offene-posten-design.md (R2, R3).
--
-- 1. Write-offs do not count on a cancelled invoice. The claim of a cancelled invoice is 0, so a
--    write-off booked before the cancellation (skonto, goodwill) would otherwise turn into credit
--    that was never paid. open = -paid for a cancelled invoice, in invoice_open_amount and in the
--    view invoice_balances, whose written_off shows 0 for a cancelled invoice so that
--    open_amount = claim - paid - written_off holds row by row.
-- 2. transfer_invoice_entry from a cancelled invoice moves at most its current credit
--    (transfer_exceeds_credit, 22023): after a partial refund the full payment cannot move any more.
-- 3. lock_dunning_notice: sent_at cannot be set back to null once set.
-- Bodies are copies of 20261008140000 and 20261008150000 with only these changes; security
-- settings, revokes and grants are unchanged.

create or replace function werkbank.invoice_open_amount(p_invoice uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select case when i.status = 'cancelled' then 0 else coalesce(t.gross_total, 0) end
    - coalesce((
        select sum(case e.kind when 'refund' then -e.amount else e.amount end)
        from werkbank.invoice_entries e
        where e.invoice_id = i.id and e.reversed_at is null
          and not (e.kind = 'write_off' and i.status = 'cancelled')), 0)
  from werkbank.invoices i
  left join werkbank.document_totals t on t.invoice_id = i.id
  where i.id = p_invoice
$$;
revoke all on function werkbank.invoice_open_amount(uuid) from public, anon;
grant execute on function werkbank.invoice_open_amount(uuid) to authenticated;

create or replace function werkbank.transfer_invoice_entry(p_entry uuid, p_target_invoice uuid, p_reason text)
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
  if v_src.status = 'cancelled' and v_e.amount > greatest(-werkbank.invoice_open_amount(v_src.id), 0) then
    raise exception 'transfer_exceeds_credit' using errcode = '22023';
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

create or replace function werkbank.lock_dunning_notice()
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
     or (v_changed && array['sent_at', 'sent_to'] and new.pdf_path is null)
     or (old.sent_at is not null and new.sent_at is null) then
    raise exception 'dunning_locked' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function werkbank.lock_dunning_notice() from public, anon;

create or replace view werkbank.invoice_balances with (security_invoker = true) as
select
  x.invoice_id, x.org_id, x.invoice_no, x.status, x.customer_id, x.property_id,
  x.customer_name, x.property_name, x.issue_date, x.due_date,
  x.claim, x.paid, x.written_off, x.open_amount,
  case
    when x.open_amount < 0 then 'overpaid'
    when x.open_amount = 0 and x.status = 'cancelled' then 'void'
    when x.open_amount = 0 and x.written_off > 0 then 'written_off'
    when x.open_amount = 0 then 'paid'
    when x.paid > 0 then 'partial'
    else 'open'
  end as payment_state,
  case
    when x.open_amount > 0 and x.due_date < (now() at time zone 'Europe/Berlin')::date
      then (now() at time zone 'Europe/Berlin')::date - x.due_date
    else 0
  end as days_overdue,
  x.last_stage, x.last_notice_date, x.hold_reason, x.hold_until
from (
  select
    i.id as invoice_id, i.org_id, i.invoice_no, i.status, i.customer_id, i.property_id,
    coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) as customer_name,
    p.name as property_name, i.issue_date, i.due_date,
    case when i.status = 'cancelled' then 0 else coalesce(t.gross_total, 0) end as claim,
    e.paid, case when i.status = 'cancelled' then 0 else e.written_off end as written_off,
    werkbank.invoice_open_amount(i.id) as open_amount,
    n.stage as last_stage, n.notice_date as last_notice_date,
    h.reason as hold_reason, h.until as hold_until
  from werkbank.invoices i
  left join werkbank.customers c on c.org_id = i.org_id and c.id = i.customer_id
  left join werkbank.properties p on p.org_id = i.org_id and p.id = i.property_id
  left join werkbank.document_totals t on t.invoice_id = i.id
  cross join lateral (
    select
      coalesce(sum(case x.kind when 'payment' then x.amount when 'refund' then -x.amount end), 0) as paid,
      coalesce(sum(x.amount) filter (where x.kind = 'write_off'), 0) as written_off
    from werkbank.invoice_entries x
    where x.invoice_id = i.id and x.reversed_at is null
  ) e
  left join lateral (
    select d.stage, d.notice_date from werkbank.dunning_notices d
    where d.invoice_id = i.id order by d.stage desc limit 1
  ) n on true
  left join werkbank.dunning_holds h
    on h.invoice_id = i.id
   and (h.until is null or h.until >= (now() at time zone 'Europe/Berlin')::date)
  where i.type = 'invoice' and i.status in ('issued', 'cancelled')
) x;

-- A hold that ended before today would never count as active: refuse it instead of storing a dead
-- row (PR review). Body otherwise as in 20261008140000.
create or replace function werkbank.set_dunning_hold(p_invoice uuid, p_reason text, p_until date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv werkbank.invoices;
begin
  v_inv := werkbank.authorize_invoice(p_invoice);
  if p_until is not null and p_until < (now() at time zone 'Europe/Berlin')::date then
    raise exception 'hold_until_past' using errcode = '22023';
  end if;
  insert into werkbank.dunning_holds (invoice_id, org_id, reason, until, created_by)
  values (v_inv.id, v_inv.org_id, p_reason, p_until, auth.uid())
  on conflict (invoice_id) do update
  set reason = excluded.reason, until = excluded.until, created_by = excluded.created_by, created_at = now();
end;
$$;
revoke all on function werkbank.set_dunning_hold(uuid, text, date) from public, anon;
grant execute on function werkbank.set_dunning_hold(uuid, text, date) to authenticated;
