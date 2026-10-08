-- Werkbank Teil 5 (R3, R4): the views invoice_balances and dunning_due, and the storage
-- protection of notice files.
-- Spec: docs/superpowers/specs/2026-10-08-werkbank-offene-posten-design.md (R3, R4).

-- invoice_balances: one row per invoice of type 'invoice' with status issued or cancelled.
-- open_amount comes from werkbank.invoice_open_amount, so the balance rule exists once; claim, paid
-- and written_off are the parts it is made of, for display. Berlin today decides days_overdue and
-- which hold is active (until is null or until >= today).
create view werkbank.invoice_balances with (security_invoker = true) as
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
    e.paid, e.written_off,
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

-- dunning_due: the issued invoices a notice is due for. Wait days come from the org's
-- company_profiles row (defaults 7/14/14 without one). Whether the previous notice was stored or
-- sent is enforced by create_dunning_notice, not here. The recipient rule lives in code.
create view werkbank.dunning_due with (security_invoker = true) as
select
  b.*,
  coalesce(b.last_stage, 0) + 1 as next_stage,
  c.invoice_email as customer_invoice_email,
  ct.email as contact_email,
  c.email as customer_email
from werkbank.invoice_balances b
join werkbank.invoices i on i.id = b.invoice_id
left join werkbank.company_profiles cp on cp.org_id = b.org_id
left join werkbank.customers c on c.org_id = b.org_id and c.id = b.customer_id
left join werkbank.contacts ct on ct.org_id = b.org_id and ct.id = i.contact_id
where b.status = 'issued'
  and b.open_amount > 0
  and b.hold_reason is null
  and coalesce(b.last_stage, 0) < 3
  and (now() at time zone 'Europe/Berlin')::date >= case coalesce(b.last_stage, 0)
        when 0 then b.due_date + coalesce(cp.reminder_after_days, 7)
        when 1 then b.last_notice_date + coalesce(cp.dunning1_after_days, 14)
        else b.last_notice_date + coalesce(cp.dunning2_after_days, 14)
      end;

grant select on werkbank.invoice_balances, werkbank.dunning_due to authenticated;

-- Storage (R4): notice files at <org>/dunning/<notice_id>.pdf are immutable like invoice files.
-- Same function and trigger as 20261008120000; only the protected path segments and the error
-- message per segment change.
create or replace function werkbank.protect_invoice_files()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.bucket_id = 'werkbank-documents' and (storage.foldername(old.name))[2] in ('invoices', 'dunning')
     -- An update is blocked only when it changes the file itself (path, version, content metadata);
     -- the Storage service may still stamp updated_at / last_accessed_at.
     and (tg_op = 'DELETE'
          or (new.bucket_id, new.name, new.version, new.metadata, new.user_metadata)
             is distinct from (old.bucket_id, old.name, old.version, old.metadata, old.user_metadata))
     and exists (select 1 from public.organizations o
                 where o.id::text = (storage.foldername(old.name))[1]) then
    raise exception '%', case (storage.foldername(old.name))[2]
                           when 'dunning' then 'dunning_locked' else 'invoice_locked' end
      using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
