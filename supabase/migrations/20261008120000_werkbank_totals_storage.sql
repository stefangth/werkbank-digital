-- Werkbank Teil 3 (R3, R4): document totals and list views, private storage buckets with policies.

-- Totals: the only implementation of the VAT and discount rules. Per VAT rate the net is the sum of
-- line_net, the discounted net is rounded once per rate, and the VAT is rounded once per rate on
-- the discounted net. net_total is the sum before the document discount, discount_total the
-- difference, gross_total the discounted net plus VAT. labour_total is the discounted labour share.
create view werkbank.document_totals with (security_invoker = true) as
with docs as (
  select q.id as quote_id, null::uuid as order_id, q.id as doc_id, q.discount_percent from werkbank.quotes q
  union all
  select null::uuid, o.id, o.id, o.discount_percent from werkbank.orders o
), per_rate as (
  select
    d.doc_id,
    i.vat_rate,
    d.discount_percent,
    sum(i.line_net) as net,
    sum(round(i.quantity * i.labour_price, 2)) as labour
  from docs d
  join werkbank.document_items i on coalesce(i.quote_id, i.order_id) = d.doc_id
  where i.kind = 'item'
  group by d.doc_id, i.vat_rate, d.discount_percent
), rated as (
  select
    r.*,
    round(r.net * (1 - r.discount_percent / 100), 2) as discounted_net
  from per_rate r
), taxed as (
  select r.*, round(r.discounted_net * r.vat_rate / 100, 2) as vat from rated r
), agg as (
  select
    t.doc_id,
    sum(t.net) as net_total,
    sum(t.discounted_net) as discounted_total,
    sum(t.vat) as vat_total,
    round(sum(t.labour) * (1 - max(t.discount_percent) / 100), 2) as labour_total,
    jsonb_agg(
      jsonb_build_object('rate', t.vat_rate, 'net', t.net, 'discounted_net', t.discounted_net, 'vat', t.vat)
      order by t.vat_rate desc
    ) as vat_breakdown
  from taxed t
  group by t.doc_id
)
select
  d.quote_id,
  d.order_id,
  coalesce(a.net_total, 0)::numeric as net_total,
  (coalesce(a.net_total, 0) - coalesce(a.discounted_total, 0))::numeric as discount_total,
  coalesce(a.vat_total, 0)::numeric as vat_total,
  (coalesce(a.discounted_total, 0) + coalesce(a.vat_total, 0))::numeric as gross_total,
  coalesce(a.labour_total, 0)::numeric as labour_total,
  coalesce(a.vat_breakdown, '[]'::jsonb) as vat_breakdown
from docs d
left join agg a on a.doc_id = d.doc_id;

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
join werkbank.customers c on c.org_id = q.org_id and c.id = q.customer_id
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
join werkbank.customers c on c.org_id = o.org_id and c.id = o.customer_id
left join werkbank.properties p on p.org_id = o.org_id and p.id = o.property_id
left join werkbank.document_totals t on t.order_id = o.id
left join lateral (
  select array_agg(a.id order by a.name, a.id) as ids, array_agg(a.name order by a.name, a.id) as names
  from werkbank.order_technicians ot
  join public.artists a on a.id = ot.artist_id
  where ot.order_id = o.id
) tech on true;

grant select on werkbank.document_totals, werkbank.quote_list, werkbank.order_list to authenticated;

-- Storage (R4): private buckets, first path segment is the org id (hire-orders model).
insert into storage.buckets (id, name, public) values
  ('werkbank-assets', 'werkbank-assets', false),
  ('werkbank-documents', 'werkbank-documents', false)
  on conflict (id) do nothing;

create policy "Werkbank staff read assets"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'werkbank-assets'
    and (public.has_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'admin')
      or public.has_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'producer'))
  );
create policy "Werkbank admins insert assets"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'werkbank-assets'
    and public.has_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'admin')
  );
create policy "Werkbank admins update assets"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'werkbank-assets'
    and public.has_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'admin')
  )
  with check (
    bucket_id = 'werkbank-assets'
    and public.has_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'admin')
  );
create policy "Werkbank admins delete assets"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'werkbank-assets'
    and public.has_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'admin')
  );
create policy "Werkbank staff read documents"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'werkbank-documents'
    and (public.has_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'admin')
      or public.has_org_role(auth.uid(), ((storage.foldername(name))[1])::uuid, 'producer'))
  );
-- No write policies on werkbank-documents: only the service role writes there.
