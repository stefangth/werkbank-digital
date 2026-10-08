-- Werkbank Teil 4 (R3, R4): invoice branch of document_totals, the invoice_list view and the
-- trigger that makes invoice PDFs in werkbank-documents immutable.

-- 1. document_totals gains invoice_id (third column, so the view is dropped and recreated with
-- its dependents quote_list and order_list, definitions unchanged). The arithmetic is that of
-- 20261007220000; a cancellation's items are positive copies of the original's, so its totals are
-- positive like those of every document (the sign is applied for display, not stored).
drop view werkbank.quote_list;
drop view werkbank.order_list;
drop view werkbank.document_totals;

create view werkbank.document_totals with (security_invoker = true) as
select
  q.id as quote_id,
  null::uuid as order_id,
  null::uuid as invoice_id,
  coalesce(t.net_total, 0)::numeric as net_total,
  (coalesce(t.net_total, 0) - coalesce(t.discounted_total, 0))::numeric as discount_total,
  coalesce(t.vat_total, 0)::numeric as vat_total,
  (coalesce(t.discounted_total, 0) + coalesce(t.vat_total, 0))::numeric as gross_total,
  coalesce(t.labour_total, 0)::numeric as labour_total,
  coalesce(t.vat_breakdown, '[]'::jsonb) as vat_breakdown
from werkbank.quotes q
cross join lateral (
  select
    sum(r.net) as net_total,
    sum(r.discounted_net) as discounted_total,
    sum(r.vat) as vat_total,
    round(sum(r.labour) * (1 - q.discount_percent / 100), 2) as labour_total,
    jsonb_agg(
      jsonb_build_object('rate', r.vat_rate, 'net', r.net, 'discounted_net', r.discounted_net, 'vat', r.vat)
      order by r.vat_rate desc
    ) as vat_breakdown
  from (
    select x.*, round(x.discounted_net * x.vat_rate / 100, 2) as vat
    from (
      select
        i.vat_rate,
        sum(i.line_net) as net,
        sum(round(i.quantity * i.labour_price, 2)) as labour,
        round(sum(i.line_net) * (1 - q.discount_percent / 100), 2) as discounted_net
      from werkbank.document_items i
      where i.quote_id = q.id and i.kind = 'item'
      group by i.vat_rate
    ) x
  ) r
) t
union all
select
  null::uuid,
  o.id,
  null::uuid,
  coalesce(t.net_total, 0)::numeric,
  (coalesce(t.net_total, 0) - coalesce(t.discounted_total, 0))::numeric,
  coalesce(t.vat_total, 0)::numeric,
  (coalesce(t.discounted_total, 0) + coalesce(t.vat_total, 0))::numeric,
  coalesce(t.labour_total, 0)::numeric,
  coalesce(t.vat_breakdown, '[]'::jsonb)
from werkbank.orders o
cross join lateral (
  select
    sum(r.net) as net_total,
    sum(r.discounted_net) as discounted_total,
    sum(r.vat) as vat_total,
    round(sum(r.labour) * (1 - o.discount_percent / 100), 2) as labour_total,
    jsonb_agg(
      jsonb_build_object('rate', r.vat_rate, 'net', r.net, 'discounted_net', r.discounted_net, 'vat', r.vat)
      order by r.vat_rate desc
    ) as vat_breakdown
  from (
    select x.*, round(x.discounted_net * x.vat_rate / 100, 2) as vat
    from (
      select
        i.vat_rate,
        sum(i.line_net) as net,
        sum(round(i.quantity * i.labour_price, 2)) as labour,
        round(sum(i.line_net) * (1 - o.discount_percent / 100), 2) as discounted_net
      from werkbank.document_items i
      where i.order_id = o.id and i.kind = 'item'
      group by i.vat_rate
    ) x
  ) r
) t
union all
select
  null::uuid,
  null::uuid,
  v.id,
  coalesce(t.net_total, 0)::numeric,
  (coalesce(t.net_total, 0) - coalesce(t.discounted_total, 0))::numeric,
  coalesce(t.vat_total, 0)::numeric,
  (coalesce(t.discounted_total, 0) + coalesce(t.vat_total, 0))::numeric,
  coalesce(t.labour_total, 0)::numeric,
  coalesce(t.vat_breakdown, '[]'::jsonb)
from werkbank.invoices v
cross join lateral (
  select
    sum(r.net) as net_total,
    sum(r.discounted_net) as discounted_total,
    sum(r.vat) as vat_total,
    round(sum(r.labour) * (1 - v.discount_percent / 100), 2) as labour_total,
    jsonb_agg(
      jsonb_build_object('rate', r.vat_rate, 'net', r.net, 'discounted_net', r.discounted_net, 'vat', r.vat)
      order by r.vat_rate desc
    ) as vat_breakdown
  from (
    select x.*, round(x.discounted_net * x.vat_rate / 100, 2) as vat
    from (
      select
        i.vat_rate,
        sum(i.line_net) as net,
        sum(round(i.quantity * i.labour_price, 2)) as labour,
        round(sum(i.line_net) * (1 - v.discount_percent / 100), 2) as discounted_net
      from werkbank.document_items i
      where i.invoice_id = v.id and i.kind = 'item'
      group by i.vat_rate
    ) x
  ) r
) t;

create view werkbank.quote_list with (security_invoker = true) as
select
  q.id, q.org_id, q.quote_no, q.version, q.superseded_by, q.superseded_from_status,
  q.customer_id, q.property_id, q.contact_id, q.location_note, q.subject,
  q.intro_text, q.closing_text, q.payment_terms_text, q.discount_percent, q.valid_until,
  q.status, q.sent_at, q.sent_to, q.pdf_path, q.pdf_sha256, q.accepted_pdf_path,
  q.link_revoked_at, q.created_at, q.updated_at,
  coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) as customer_name,
  p.name as property_name,
  t.net_total, t.discount_total, t.vat_total, t.gross_total, t.labour_total, t.vat_breakdown,
  (q.status = 'sent' and q.valid_until < (now() at time zone 'Europe/Berlin')::date) as is_expired,
  exists (select 1 from werkbank.orders o where o.quote_id = q.id) as has_order
from werkbank.quotes q
left join werkbank.customers c on c.org_id = q.org_id and c.id = q.customer_id
left join werkbank.properties p on p.org_id = q.org_id and p.id = q.property_id
left join werkbank.document_totals t on t.quote_id = q.id;

create view werkbank.order_list with (security_invoker = true) as
select
  o.id, o.org_id, o.order_no, o.quote_id, o.customer_id, o.property_id, o.contact_id,
  o.location_note, o.subject, o.discount_percent, o.notes, o.status,
  o.scheduled_date, o.scheduled_time, o.completed_at, o.cancelled_at, o.created_at, o.updated_at,
  coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) as customer_name,
  p.name as property_name,
  t.net_total, t.discount_total, t.vat_total, t.gross_total, t.labour_total, t.vat_breakdown,
  coalesce(tech.ids, '{}'::uuid[]) as technician_ids,
  coalesce(tech.names, '{}'::text[]) as technician_names
from werkbank.orders o
left join werkbank.customers c on c.org_id = o.org_id and c.id = o.customer_id
left join werkbank.properties p on p.org_id = o.org_id and p.id = o.property_id
left join werkbank.document_totals t on t.order_id = o.id
left join lateral (
  select array_agg(a.id order by a.name, a.id) as ids, array_agg(a.name order by a.name, a.id) as names
  from werkbank.order_technicians ot
  join public.artists a on a.id = ot.artist_id
  where ot.order_id = o.id
) tech on true;

grant select on werkbank.document_totals, werkbank.quote_list, werkbank.order_list to authenticated;

-- 2. invoice_list: every invoices column plus customer, property, totals and the cancellation
-- links (cancelled_by_no: number of the issued cancellation of this invoice; cancels_no: number
-- of the invoice a cancellation cancels).
create view werkbank.invoice_list with (security_invoker = true) as
select
  i.*,
  coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) as customer_name,
  p.name as property_name,
  t.gross_total, t.net_total,
  x.invoice_no as cancelled_by_no,
  o.invoice_no as cancels_no
from werkbank.invoices i
left join werkbank.customers c on c.org_id = i.org_id and c.id = i.customer_id
left join werkbank.properties p on p.org_id = i.org_id and p.id = i.property_id
left join werkbank.document_totals t on t.invoice_id = i.id
left join werkbank.invoices x on x.org_id = i.org_id and x.cancels_invoice_id = i.id and x.status = 'issued'
left join werkbank.invoices o on o.org_id = i.org_id and o.id = i.cancels_invoice_id;
grant select on werkbank.invoice_list to authenticated;

-- 3. Invoice files are immutable (R4): once written, an object at <org>/invoices/... in the
-- bucket werkbank-documents can be neither replaced nor deleted, whoever asks (the service role
-- included), as long as the org exists. Once the org row is deleted (erasure, ADR-0013 removal),
-- its invoice files can be deleted through the Storage API. The trigger sits on storage.objects,
-- so nothing in public depends on schema werkbank.
create function werkbank.protect_invoice_files()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.bucket_id = 'werkbank-documents' and (storage.foldername(old.name))[2] = 'invoices'
     and exists (select 1 from public.organizations o
                 where o.id::text = (storage.foldername(old.name))[1]) then
    raise exception 'invoice_locked' using errcode = '55000';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function werkbank.protect_invoice_files() from public, anon;

create trigger protect_invoice_files before update or delete on storage.objects
  for each row execute function werkbank.protect_invoice_files();
