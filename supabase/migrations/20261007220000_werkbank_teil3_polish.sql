-- Werkbank Teil 3 polish: follow-ups to 20261007180000..210000 (which stay unchanged).
-- Spec: docs/superpowers/specs/2026-10-07-werkbank-angebot-auftrag-design.md.

-- 1. The artist check runs as the caller. Admins and producers read their org's artists through
-- RLS ("Admins and producers can view all artist data"), the service role and the owner context
-- bypass it. A non-member sees no artist of the org, so every insert of theirs fails the same way
-- (artist_org_mismatch) and learns nothing about who belongs to which org.
alter function werkbank.check_artist_org() security invoker;
comment on function werkbank.check_artist_org() is
  'order_technicians: the artist must belong to the order''s org. SECURITY INVOKER: callers without read access to the org''s artists always get artist_org_mismatch.';

-- 2. Catalog references stay inside the org: composite FK over (org_id, catalog_item_id), like
-- every other document reference. Cross-org references cannot be created through the API (the
-- old FK only checked the id), but any that exist are cleared first. This runs in the owner
-- context, which the lock triggers let clear catalog_item_id on locked documents.
alter table werkbank.catalog_items add constraint catalog_items_org_id_id_key unique (org_id, id);
update werkbank.document_items i
set catalog_item_id = null
where i.catalog_item_id is not null
  and not exists (
    select 1 from werkbank.catalog_items c where c.id = i.catalog_item_id and c.org_id = i.org_id
  );
alter table werkbank.document_items
  drop constraint document_items_catalog_item_id_fkey,
  add constraint document_items_catalog_fk foreign key (org_id, catalog_item_id)
    references werkbank.catalog_items (org_id, id) on delete set null (catalog_item_id);

-- 3. Indexes for the FK columns without one (FK actions and the lookups by them).
create index document_items_source_item_id_idx on werkbank.document_items (source_item_id);
create index document_items_catalog_item_id_idx on werkbank.document_items (catalog_item_id);
create index quotes_superseded_by_idx on werkbank.quotes (superseded_by);
create index quotes_property_id_idx on werkbank.quotes (property_id);
create index quotes_contact_id_idx on werkbank.quotes (contact_id);
create index orders_property_id_idx on werkbank.orders (property_id);
create index orders_contact_id_idx on werkbank.orders (contact_id);

-- 4. revise_quote: the role check comes before the row lock, so a caller without access cannot
-- hold a lock on another org's quote. A revision of a quote past its date (Berlin) is valid from
-- today plus the profile's validity (30 days without a profile); otherwise it keeps the date.
create or replace function werkbank.revise_quote(p_quote uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_q werkbank.quotes;
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_days integer;
  v_id uuid;
begin
  select q.org_id into v_org from werkbank.quotes q where q.id = p_quote;
  if auth.uid() is null or not found
     or not (public.has_org_role(auth.uid(), v_org, 'admin') or public.has_org_role(auth.uid(), v_org, 'producer')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_q from werkbank.quotes where id = p_quote for update;
  -- The row can be deleted between the check and the lock (a concurrent delete, e.g. of its org).
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_q.status not in ('sent', 'rejected') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  select p.quote_validity_days into v_days from werkbank.company_profiles p where p.org_id = v_q.org_id;

  insert into werkbank.quotes (org_id, quote_no, version, customer_id, property_id, contact_id, location_note,
    subject, intro_text, closing_text, payment_terms_text, discount_percent, valid_until)
  values (v_q.org_id, v_q.quote_no, v_q.version + 1, v_q.customer_id, v_q.property_id, v_q.contact_id,
    v_q.location_note, v_q.subject, v_q.intro_text, v_q.closing_text, v_q.payment_terms_text,
    v_q.discount_percent,
    case when v_q.valid_until < v_today then v_today + coalesce(v_days, 30) else v_q.valid_until end)
  returning id into v_id;

  insert into werkbank.document_items (org_id, quote_id, sort_order, kind, name, description, catalog_item_id,
    item_no, quantity, unit_code, labour_price, material_price, vat_rate)
  select i.org_id, v_id, i.sort_order, i.kind, i.name, i.description, i.catalog_item_id,
    i.item_no, i.quantity, i.unit_code, i.labour_price, i.material_price, i.vat_rate
  from werkbank.document_items i
  where i.quote_id = p_quote
  order by i.sort_order;

  update werkbank.quotes
  set status = 'superseded', superseded_by = v_id, superseded_from_status = v_q.status,
    link_revoked_at = coalesce(link_revoked_at, now())
  where id = p_quote;

  return v_id;
end;
$$;
revoke all on function werkbank.revise_quote(uuid) from public, anon;
grant execute on function werkbank.revise_quote(uuid) to authenticated;

-- 5. document_totals without the materialised CTE: one branch per document kind, the items joined
-- by their own parent column (laterally), so a filter on quote_id or order_id reaches the quote or
-- order key and the item index. The arithmetic is the one of 20261007200000, unchanged: per VAT
-- rate the net is the sum of line_net, the discounted net is rounded once per rate, the VAT once
-- per rate on the discounted net; labour_total is the discounted labour share.
create or replace view werkbank.document_totals with (security_invoker = true) as
select
  q.id as quote_id,
  null::uuid as order_id,
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
) t;

-- 6. Item edits touch their draft quote: send compares quotes.updated_at, so an item-only edit
-- between reading and sending a draft now fails that guard like a header edit does. Only draft
-- quotes are touched: items of other quotes are locked (and an FK set-null on them must not
-- rewrite a locked quote). Runs as the caller, who may update the quote when they may edit its
-- items (same policies); the lock trigger lets an updated_at-only change through.
create function werkbank.touch_draft_quote()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_quote uuid := case when tg_op = 'DELETE' then old.quote_id else new.quote_id end;
begin
  if v_quote is not null then
    update werkbank.quotes q set updated_at = now()
    where q.id = v_quote and q.status = 'draft' and q.updated_at is distinct from now();
  end if;
  return null;
end;
$$;
revoke all on function werkbank.touch_draft_quote() from public, anon;

create trigger document_items_touch_draft_quote after insert or update or delete on werkbank.document_items
  for each row execute function werkbank.touch_draft_quote();

-- 7. Logos only: PNG or JPEG up to 1 MB (the bucket is created in 20261007200000).
update storage.buckets
set file_size_limit = 1048576, allowed_mime_types = array['image/png', 'image/jpeg']
where id = 'werkbank-assets';

-- 8. A scheduled time never outlives its date. The check constraint orders_time_needs_date would
-- reject the pair; this BEFORE trigger clears the time instead, so clearing the date in the UI
-- (or setting a time before a date) cannot fail the write. Named orders_a_* so it fires first
-- (BEFORE triggers run in name order), ahead of orders_transition; the constraint is checked
-- after all BEFORE triggers.
create function werkbank.clear_order_time_without_date()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.scheduled_date is null then
    new.scheduled_time := null;
  end if;
  return new;
end;
$$;
revoke all on function werkbank.clear_order_time_without_date() from public, anon;

create trigger orders_a_clear_time before insert or update on werkbank.orders
  for each row execute function werkbank.clear_order_time_without_date();
