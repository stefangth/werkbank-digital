-- Werkbank Teil 6a (R1): visit reports of the technician app, their photos and orders.completed_by.
-- Spec: docs/superpowers/specs/2026-10-08-werkbank-monteur-app-design.md (R1).
-- The three trigger contexts (user, service role, owner) are those of 20261007190000: technicians
-- write only through the SECURITY DEFINER RPCs of 20261008180000, the office only office_note.

-- 1. orders.completed_by: who reported the order done (set by order_transition below).
alter table werkbank.orders
  add column completed_by uuid references auth.users(id) on delete set null;

-- 2. visit_reports ----------------------------------------------------------------------
create table werkbank.visit_reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null,
  artist_id uuid references public.artists(id) on delete set null,
  technician_name text not null,
  visit_date date not null default (now() at time zone 'Europe/Berlin')::date,
  body text not null default '' check (char_length(body) <= 10000),
  locked_at timestamptz,
  signer_name text,
  signature_path text,
  signed_at timestamptz,
  office_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint visit_reports_org_id_id_key unique (org_id, id),
  constraint visit_reports_order_fk foreign key (org_id, order_id)
    references werkbank.orders (org_id, id) on delete no action,
  constraint visit_reports_signature_all_or_none check (
    (signer_name is null and signature_path is null and signed_at is null)
    or (signer_name is not null and signature_path is not null and signed_at is not null)),
  constraint visit_reports_signed_is_locked check (signed_at is null or locked_at is not null)
);
create index visit_reports_org_order_idx on werkbank.visit_reports (org_id, order_id);
create index visit_reports_artist_id_idx on werkbank.visit_reports (artist_id);
create trigger visit_reports_set_updated_at before update on werkbank.visit_reports
  for each row execute function public.update_updated_at_column();

-- 3. visit_report_photos ----------------------------------------------------------------
create table werkbank.visit_report_photos (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  report_id uuid not null,
  path text not null unique,
  position integer not null,
  caption text check (char_length(caption) <= 200),
  created_at timestamptz not null default now(),
  constraint visit_report_photos_report_fk foreign key (org_id, report_id)
    references werkbank.visit_reports (org_id, id) on delete cascade
);
create index visit_report_photos_report_id_idx on werkbank.visit_report_photos (report_id);

-- 4. Lock trigger ---------------------------------------------------------------------------
-- visit_reports: no report on a cancelled or invoiced order (55000 order_closed). A locked report
-- keeps every column except office_note and updated_at (55000 report_locked); the owner context
-- may clear artist_id (FK set-null when the author's artist row is deleted). Only an unlocked
-- report with an empty body and no photos may be deleted (55000 report_not_empty; locked:
-- report_locked).
-- visit_report_photos: insert, update and delete need an unlocked parent report (55000
-- report_locked).
-- An org delete cascades through both tables: once the org row is gone every check is skipped.
create function werkbank.visit_report_lock()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner boolean := current_user not in ('authenticated', 'anon', 'service_role');
  v_org uuid := case when tg_op = 'DELETE' then old.org_id else new.org_id end;
  v_changed text[];
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations o where o.id = v_org) then
    return old;
  end if;

  if tg_table_name = 'visit_report_photos' then
    -- Share-lock the report, so a concurrent lock or sign either waits for this photo write or has
    -- committed and is seen by the check below.
    perform 1 from werkbank.visit_reports r
    where r.id = case when tg_op = 'DELETE' then old.report_id else new.report_id end
       or (tg_op = 'UPDATE' and r.id = old.report_id)
    for share;
    if exists (
      select 1 from werkbank.visit_reports r
      where r.locked_at is not null
        and (r.id = case when tg_op = 'DELETE' then old.report_id else new.report_id end
             or (tg_op = 'UPDATE' and r.id = old.report_id))
    ) then
      raise exception 'report_locked' using errcode = '55000';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- werkbank.visit_reports
  if tg_op = 'INSERT' then
    if exists (
      select 1 from werkbank.orders o
      where o.org_id = new.org_id and o.id = new.order_id and o.status in ('cancelled', 'invoiced')
    ) then
      raise exception 'order_closed' using errcode = '55000';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.locked_at is not null then
      raise exception 'report_locked' using errcode = '55000';
    end if;
    if old.body <> '' or exists (select 1 from werkbank.visit_report_photos p where p.report_id = old.id) then
      raise exception 'report_not_empty' using errcode = '55000';
    end if;
    return old;
  end if;

  if old.locked_at is not null then
    v_changed := array(
      select n.key from jsonb_each(to_jsonb(new)) n
      where n.value is distinct from to_jsonb(old) -> n.key
        and n.key not in ('office_note', 'updated_at')
        and not (v_owner and n.key = 'artist_id' and n.value = 'null'::jsonb));
    if cardinality(v_changed) > 0 then
      raise exception 'report_locked' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function werkbank.visit_report_lock() from public, anon;

create trigger visit_reports_lock before insert or update or delete on werkbank.visit_reports
  for each row execute function werkbank.visit_report_lock();
create trigger visit_report_photos_lock before insert or update or delete on werkbank.visit_report_photos
  for each row execute function werkbank.visit_report_lock();

-- 5. RLS and grants ---------------------------------------------------------------------
-- Read: admin and producer. Write: the office updates office_note only (column grant); inserts,
-- deletes and every photo write go through the technician RPCs (no table grant).
alter table werkbank.visit_reports enable row level security;
alter table werkbank.visit_report_photos enable row level security;

grant update (office_note) on werkbank.visit_reports to authenticated;

create policy visit_reports_select on werkbank.visit_reports for select to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));
create policy visit_reports_update on werkbank.visit_reports for update to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))
  with check (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));
create policy visit_report_photos_select on werkbank.visit_report_photos for select to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));

-- 6. Order transitions with completed_by ------------------------------------------------------
-- As in 20261008110000, plus: completed_by is set to auth.uid() on in_progress -> done, cleared on
-- done -> in_progress and otherwise kept (a direct write is ignored; the owner context may clear
-- it, which is the FK set-null when the user is deleted). It is left out of the lock check of
-- done, invoiced and cancelled orders.
create or replace function werkbank.order_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user boolean := current_user in ('authenticated', 'anon');
  v_owner boolean := current_user not in ('authenticated', 'anon', 'service_role');
  v_changed text[];
  v_status text;
begin
  if tg_table_name in ('document_items', 'order_technicians') then
    -- Provenance: only the owner context links an item to its source line.
    -- Nested ifs: order_technicians has no source_item_id, so the field is read only for items.
    if tg_table_name = 'document_items' and v_user and tg_op <> 'DELETE' then
      if (tg_op = 'INSERT' and new.source_item_id is not null)
         or (tg_op = 'UPDATE' and new.source_item_id is distinct from old.source_item_id) then
        raise exception 'provenance_service_only' using errcode = '42501';
      end if;
    end if;
    if (tg_op = 'DELETE' and v_owner)
       or (case when tg_op = 'DELETE' then old.order_id else new.order_id end) is null then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    if tg_op = 'UPDATE' and v_owner then
      v_changed := array(
        select n.key from jsonb_each(to_jsonb(new)) n
        where n.value is distinct from to_jsonb(old) -> n.key and n.key <> 'updated_at'
          and not (n.key in ('catalog_item_id', 'source_item_id') and n.value = 'null'::jsonb)
          and n.key not in (select a.attname from pg_catalog.pg_attribute a where a.attrelid = tg_relid and a.attgenerated <> ''));
      if cardinality(v_changed) = 0 then
        return new;
      end if;
    end if;
    if exists (
      select 1 from werkbank.orders o
      where o.status in ('done', 'invoiced', 'cancelled')
        and (o.id = case when tg_op = 'DELETE' then old.order_id else new.order_id end
             or (tg_op = 'UPDATE' and o.id = old.order_id))
    ) then
      raise exception 'order_locked' using errcode = '55000';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- werkbank.orders
  if v_user and (
    (tg_op = 'INSERT' and new.quote_id is not null)
    or (tg_op = 'UPDATE' and new.quote_id is distinct from old.quote_id)
  ) then
    raise exception 'provenance_service_only' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if v_user and new.order_no is not null then
      raise exception 'order_service_only' using errcode = '42501';
    end if;
    if new.status <> 'open' then
      raise exception 'invalid_transition' using errcode = '22023';
    end if;
    new.completed_at := null;
    new.completed_by := null;
    new.cancelled_at := null;
    return new;
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'open' and new.status in ('in_progress', 'cancelled'))
    or (old.status = 'in_progress' and new.status in ('done', 'cancelled'))
    or (old.status = 'done' and new.status = 'in_progress')
    or (v_owner and old.status = 'done' and new.status = 'invoiced')
    or (v_owner and old.status = 'invoiced' and new.status = 'done')
  ) then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  if old.status in ('done', 'invoiced', 'cancelled') then
    v_changed := array(
      select n.key from jsonb_each(to_jsonb(new)) n
      where n.value is distinct from to_jsonb(old) -> n.key
        and n.key not in ('updated_at', 'status', 'completed_at', 'completed_by', 'cancelled_at')
        and not (v_owner and n.key = 'contact_id' and n.value = 'null'::jsonb)
        and n.key not in (select a.attname from pg_catalog.pg_attribute a where a.attrelid = tg_relid and a.attgenerated <> ''));
    if cardinality(v_changed) > 0 then
      raise exception 'order_locked' using errcode = '55000';
    end if;
  end if;

  new.completed_at := case when new.status = 'done' and old.status not in ('done', 'invoiced') then now()
    else old.completed_at end;
  new.completed_by := case
    when new.status = 'done' and old.status = 'in_progress' then auth.uid()
    when new.status = 'in_progress' and old.status = 'done' then null
    when v_owner and new.completed_by is null then null
    else old.completed_by end;
  new.cancelled_at := case when new.status = 'cancelled' and old.status <> 'cancelled' then now() else old.cancelled_at end;
  return new;
end;
$$;
revoke all on function werkbank.order_transition() from public, anon;

-- 7. order_list gains completed_by and completed_by_technician (a technician of the order's org
-- reported it done). Nothing depends on the view, so it is dropped and recreated; the columns
-- before the two new ones are those of 20261008120000.
drop view werkbank.order_list;
create view werkbank.order_list with (security_invoker = true) as
select
  o.id, o.org_id, o.order_no, o.quote_id, o.customer_id, o.property_id, o.contact_id,
  o.location_note, o.subject, o.discount_percent, o.notes, o.status,
  o.scheduled_date, o.scheduled_time, o.completed_at, o.cancelled_at, o.created_at, o.updated_at,
  coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')) as customer_name,
  p.name as property_name,
  t.net_total, t.discount_total, t.vat_total, t.gross_total, t.labour_total, t.vat_breakdown,
  coalesce(tech.ids, '{}'::uuid[]) as technician_ids,
  coalesce(tech.names, '{}'::text[]) as technician_names,
  o.completed_by,
  exists (
    select 1 from public.artists a where a.org_id = o.org_id and a.user_id = o.completed_by
  ) as completed_by_technician
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

grant select on werkbank.order_list to authenticated;
