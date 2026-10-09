-- Werkbank Teil 6a (R2, R3): the technician RPCs, the completion notification, the private bucket
-- werkbank-visits and its storage policies.
-- Spec: docs/superpowers/specs/2026-10-08-werkbank-monteur-app-design.md (R2, R3).
-- Technicians read and write orders and visit reports only through these SECURITY DEFINER RPCs. The
-- caller's technician row is public.artists where user_id = auth.uid() and org_id = the order's org;
-- a missing order and a missing assignment both raise not_assigned (42501), so ids cannot be probed.
-- The caller must also be a member of that org (public.is_org_member): remove_org_member keeps the
-- artist row linked, and these functions bypass the RESTRICTIVE org_isolation policy.

-- 1. Private helpers ---------------------------------------------------------------------------

-- The caller's technician row for an order they are assigned to; not_assigned otherwise.
create function werkbank.assigned_artist(p_order uuid)
returns public.artists
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_artist public.artists;
begin
  select a.* into v_artist
  from werkbank.orders o
  join werkbank.order_technicians ot on ot.order_id = o.id and ot.org_id = o.org_id
  join public.artists a on a.id = ot.artist_id and a.org_id = o.org_id
  where o.id = p_order and auth.uid() is not null and a.user_id = auth.uid()
    and public.is_org_member(auth.uid(), o.org_id);
  if not found then
    raise exception 'not_assigned' using errcode = '42501';
  end if;
  return v_artist;
end;
$$;
revoke all on function werkbank.assigned_artist(uuid) from public, anon, authenticated;

-- The list group of an order on a given Berlin day, null when it is not listed. Windows: upcoming
-- is today + 1 to today + 7, done is the last 14 days (UPCOMING_DAYS and DONE_WINDOW_DAYS in
-- src/features/werkbank/lib/visitDefaults.ts).
create function werkbank.assignment_group(p_status text, p_scheduled date, p_completed_at timestamptz, p_today date)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when p_status in ('open', 'in_progress') then
      case
        when p_scheduled is null then 'unscheduled'
        when p_scheduled < p_today then 'overdue'
        when p_scheduled = p_today then 'today'
        when p_scheduled <= p_today + 7 then 'upcoming'
      end
    when p_status in ('done', 'invoiced')
      and (p_completed_at at time zone 'Europe/Berlin')::date >= p_today - 14 then 'done'
  end
$$;
revoke all on function werkbank.assignment_group(text, date, timestamptz, date) from public, anon, authenticated;

-- The report row locked for a write by its author: not_assigned (unknown report or no longer
-- assigned), not_author, report_locked.
create function werkbank.authored_open_report(p_report uuid)
returns werkbank.visit_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report werkbank.visit_reports;
  v_artist public.artists;
begin
  -- Check the assignment before taking the row lock, so a caller who is not on the order cannot
  -- hold the author's report even briefly; then lock and re-read.
  select * into v_report from werkbank.visit_reports r where r.id = p_report;
  if not found then
    raise exception 'not_assigned' using errcode = '42501';
  end if;
  v_artist := werkbank.assigned_artist(v_report.order_id);
  select * into v_report from werkbank.visit_reports r where r.id = p_report for update;
  if v_report.artist_id is distinct from v_artist.id then
    raise exception 'not_author' using errcode = '42501';
  end if;
  if v_report.locked_at is not null then
    raise exception 'report_locked' using errcode = '55000';
  end if;
  -- A cancelled or invoiced order's documentation stays as it was when the order closed.
  perform 1 from werkbank.orders o
    where o.id = v_report.order_id and o.status in ('cancelled', 'invoiced') for share;
  if found then
    raise exception 'order_closed' using errcode = '55000';
  end if;
  return v_report;
end;
$$;
revoke all on function werkbank.authored_open_report(uuid) from public, anon, authenticated;

-- 2. Reads -------------------------------------------------------------------------------------

create function werkbank.my_technician_orgs()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct a.org_id
  from public.artists a
  join public.organizations o on o.id = a.org_id
  where auth.uid() is not null and a.user_id = auth.uid() and o.org_kind = 'handwerk'
    and public.is_org_member(auth.uid(), a.org_id)
$$;
revoke all on function werkbank.my_technician_orgs() from public, anon;
grant execute on function werkbank.my_technician_orgs() to authenticated;

-- The caller's assigned orders in p_org with their group. p_today defaults to the Berlin date and
-- is passed only by tests. The address is the property's, else the customer's.
create function werkbank.my_assignments(p_org uuid, p_today date default null)
returns table (id uuid, order_no text, status text, scheduled_date date, scheduled_time time, subject text,
  customer_name text, street text, postal_code text, city text, group_key text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.order_no, o.status, o.scheduled_date, o.scheduled_time, o.subject,
    coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
    coalesce(p.street, c.street), coalesce(p.postal_code, c.postal_code), coalesce(p.city, c.city),
    g.group_key
  from werkbank.orders o
  join werkbank.order_technicians ot on ot.order_id = o.id and ot.org_id = o.org_id
  join public.artists a on a.id = ot.artist_id and a.org_id = o.org_id
  join werkbank.customers c on c.org_id = o.org_id and c.id = o.customer_id
  left join werkbank.properties p on p.org_id = o.org_id and p.id = o.property_id
  cross join lateral (select werkbank.assignment_group(o.status, o.scheduled_date, o.completed_at,
    coalesce(p_today, (now() at time zone 'Europe/Berlin')::date)) as group_key) g
  where o.org_id = p_org and auth.uid() is not null and a.user_id = auth.uid() and g.group_key is not null
    and public.is_org_member(auth.uid(), p_org)
  order by o.scheduled_date nulls last, o.scheduled_time nulls last, o.order_no
$$;
revoke all on function werkbank.my_assignments(uuid, date) from public, anon;
grant execute on function werkbank.my_assignments(uuid, date) to authenticated;

-- One assigned order with contact, line items (no prices), technicians and visit reports. Never
-- returns prices, discounts, totals or office_note.
create function werkbank.my_assignment(p_order uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_artist public.artists := werkbank.assigned_artist(p_order);
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  return (
    select jsonb_build_object(
      'order', jsonb_build_object(
        'id', o.id, 'org_id', o.org_id, 'order_no', o.order_no, 'status', o.status,
        'scheduled_date', o.scheduled_date, 'scheduled_time', o.scheduled_time, 'subject', o.subject,
        'customer_name', coalesce(nullif(btrim(c.company_name), ''), nullif(btrim(concat_ws(' ', c.first_name, c.last_name)), '')),
        'street', coalesce(p.street, c.street), 'postal_code', coalesce(p.postal_code, c.postal_code),
        'city', coalesce(p.city, c.city),
        'group_key', werkbank.assignment_group(o.status, o.scheduled_date, o.completed_at, v_today),
        'location_note', o.location_note, 'notes', o.notes),
      'contact', (
        select jsonb_build_object('name', concat_ws(' ', nullif(btrim(k.first_name), ''), k.last_name),
          'phone', k.phone, 'mobile', k.mobile, 'email', k.email)
        from werkbank.contacts k where k.org_id = o.org_id and k.id = o.contact_id),
      'items', coalesce((
        select jsonb_agg(jsonb_build_object('position', i.sort_order, 'title', i.name, 'description', i.description,
          'quantity', i.quantity, 'unit', i.unit_code, 'kind', i.kind) order by i.sort_order, i.id)
        from werkbank.document_items i where i.order_id = o.id), '[]'::jsonb),
      'technicians', coalesce((
        select jsonb_agg(a.name order by a.name, a.id)
        from werkbank.order_technicians ot join public.artists a on a.id = ot.artist_id
        where ot.order_id = o.id), '[]'::jsonb),
      'reports', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'artist_id', r.artist_id, 'technician_name', r.technician_name, 'visit_date', r.visit_date,
          'body', r.body, 'locked_at', r.locked_at, 'signer_name', r.signer_name,
          'signature_path', r.signature_path, 'signed_at', r.signed_at,
          'is_mine', r.artist_id is not distinct from v_artist.id,
          'photos', coalesce((
            select jsonb_agg(jsonb_build_object('id', ph.id, 'path', ph.path, 'position', ph.position, 'caption', ph.caption)
              order by ph.position, ph.id)
            from werkbank.visit_report_photos ph where ph.report_id = r.id), '[]'::jsonb))
          order by r.visit_date, r.created_at, r.id)
        from werkbank.visit_reports r where r.org_id = o.org_id and r.order_id = o.id), '[]'::jsonb))
    from werkbank.orders o
    join werkbank.customers c on c.org_id = o.org_id and c.id = o.customer_id
    left join werkbank.properties p on p.org_id = o.org_id and p.id = o.property_id
    where o.id = p_order);
end;
$$;
revoke all on function werkbank.my_assignment(uuid) from public, anon;
grant execute on function werkbank.my_assignment(uuid) to authenticated;

-- 3. Status ------------------------------------------------------------------------------------

create function werkbank.start_assignment(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  perform werkbank.assigned_artist(p_order);
  select o.status into v_status from werkbank.orders o where o.id = p_order for update;
  perform werkbank.assigned_artist(p_order);
  if v_status <> 'open' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  update werkbank.orders set status = 'in_progress' where id = p_order;
end;
$$;
revoke all on function werkbank.start_assignment(uuid) from public, anon;
grant execute on function werkbank.start_assignment(uuid) to authenticated;

-- in_progress -> done (order_transition records completed_by = auth.uid()), then one in-app
-- notification for every admin and producer of the org except the caller. The order row lock makes
-- a second, concurrent call wait and then fail invalid_transition, so there is one notification set.
create function werkbank.complete_assignment(p_order uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artist public.artists;
  v_order werkbank.orders;
begin
  perform werkbank.assigned_artist(p_order);
  select * into v_order from werkbank.orders o where o.id = p_order for update;
  v_artist := werkbank.assigned_artist(p_order);
  if v_order.status <> 'in_progress' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  update werkbank.orders set status = 'done' where id = p_order;

  insert into public.notifications (user_id, org_id, type, title, message, related_entity_type, related_entity_id)
  select distinct m.user_id, v_order.org_id, 'werkbank_order_completed', 'Auftrag erledigt',
    v_artist.name || ' hat Auftrag ' || v_order.order_no || ' als erledigt gemeldet.',
    'werkbank_order', v_order.id
  from public.org_memberships m
  where m.org_id = v_order.org_id and m.role in ('admin', 'producer') and m.user_id <> auth.uid();
end;
$$;
revoke all on function werkbank.complete_assignment(uuid) from public, anon;
grant execute on function werkbank.complete_assignment(uuid) to authenticated;

-- 4. Visit reports -----------------------------------------------------------------------------

-- A new unlocked report authored by the caller. The order row is locked first, so a concurrent
-- cancel or invoice either waits or is seen by the status check (order_closed).
create function werkbank.create_visit_report(p_order uuid, p_visit_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_artist public.artists;
  v_order werkbank.orders;
  v_id uuid;
begin
  perform werkbank.assigned_artist(p_order);
  select * into v_order from werkbank.orders o where o.id = p_order for update;
  v_artist := werkbank.assigned_artist(p_order);
  if v_order.status in ('cancelled', 'invoiced') then
    raise exception 'order_closed' using errcode = '55000';
  end if;
  insert into werkbank.visit_reports (org_id, order_id, artist_id, technician_name, visit_date)
  values (v_order.org_id, v_order.id, v_artist.id, v_artist.name,
    coalesce(p_visit_date, (now() at time zone 'Europe/Berlin')::date))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function werkbank.create_visit_report(uuid, date) from public, anon;
grant execute on function werkbank.create_visit_report(uuid, date) to authenticated;

create function werkbank.update_visit_report(p_report uuid, p_body text, p_visit_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report werkbank.visit_reports := werkbank.authored_open_report(p_report);
begin
  if char_length(coalesce(p_body, '')) > 10000 then
    raise exception 'body_too_long' using errcode = '22023';
  end if;
  update werkbank.visit_reports
  set body = coalesce(p_body, ''), visit_date = coalesce(p_visit_date, visit_date)
  where id = v_report.id;
end;
$$;
revoke all on function werkbank.update_visit_report(uuid, text, date) from public, anon;
grant execute on function werkbank.update_visit_report(uuid, text, date) to authenticated;

-- Registers an uploaded photo: the path must be <org>/<order>/<report>/<file> of this report, not
-- the signature, and exist in werkbank-visits (photo_missing). At most 20 photos per report
-- (MAX_PHOTOS_PER_REPORT in src/features/werkbank/lib/visitDefaults.ts).
create function werkbank.add_visit_photo(p_report uuid, p_path text, p_caption text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report werkbank.visit_reports := werkbank.authored_open_report(p_report);
  v_prefix text := v_report.org_id || '/' || v_report.order_id || '/' || v_report.id || '/';
  v_file text;
  v_id uuid;
begin
  v_file := case when left(p_path, length(v_prefix)) = v_prefix then substr(p_path, length(v_prefix) + 1) end;
  if v_file is null or v_file = '' or v_file = 'signature.png' or position('/' in v_file) > 0
     or not exists (select 1 from storage.objects s where s.bucket_id = 'werkbank-visits' and s.name = p_path) then
    raise exception 'photo_missing' using errcode = '22023';
  end if;
  -- A retry after a lost answer registers the same path again: return the existing row.
  select ph.id into v_id from werkbank.visit_report_photos ph where ph.report_id = v_report.id and ph.path = p_path;
  if found then
    return v_id;
  end if;
  if (select count(*) from werkbank.visit_report_photos ph where ph.report_id = v_report.id) >= 20 then
    raise exception 'photo_limit' using errcode = '22023';
  end if;
  insert into werkbank.visit_report_photos (org_id, report_id, path, position, caption)
  values (v_report.org_id, v_report.id, p_path,
    coalesce((select max(ph.position) + 1 from werkbank.visit_report_photos ph where ph.report_id = v_report.id), 0),
    nullif(btrim(p_caption), ''))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function werkbank.add_visit_photo(uuid, text, text) from public, anon;
grant execute on function werkbank.add_visit_photo(uuid, text, text) to authenticated;

-- Deletes the photo row and returns its path; the client then deletes the object (best effort).
create function werkbank.remove_visit_photo(p_photo uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report_id uuid;
  v_path text;
begin
  select ph.report_id into v_report_id from werkbank.visit_report_photos ph where ph.id = p_photo;
  if not found then
    raise exception 'not_assigned' using errcode = '42501';
  end if;
  perform werkbank.authored_open_report(v_report_id);
  delete from werkbank.visit_report_photos where id = p_photo returning path into v_path;
  if v_path is null then
    raise exception 'not_assigned' using errcode = '42501';
  end if;
  return v_path;
end;
$$;
revoke all on function werkbank.remove_visit_photo(uuid) from public, anon;
grant execute on function werkbank.remove_visit_photo(uuid) to authenticated;

-- Close without signature.
create function werkbank.lock_visit_report(p_report uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform werkbank.authored_open_report(p_report);
  update werkbank.visit_reports set locked_at = now() where id = p_report;
end;
$$;
revoke all on function werkbank.lock_visit_report(uuid) from public, anon;
grant execute on function werkbank.lock_visit_report(uuid) to authenticated;

-- Signer, signature, signed_at and locked_at in one statement. The signature must be the report's
-- uploaded <org>/<order>/<report>/signature.png (photo_missing otherwise).
create function werkbank.sign_visit_report(p_report uuid, p_signer_name text, p_signature_path text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_report werkbank.visit_reports := werkbank.authored_open_report(p_report);
  v_signer text := nullif(btrim(p_signer_name), '');
begin
  if v_signer is null then
    raise exception 'signer_required' using errcode = '22023';
  end if;
  if p_signature_path is distinct from (v_report.org_id || '/' || v_report.order_id || '/' || v_report.id || '/signature.png')
     or not exists (select 1 from storage.objects s where s.bucket_id = 'werkbank-visits' and s.name = p_signature_path) then
    raise exception 'photo_missing' using errcode = '22023';
  end if;
  update werkbank.visit_reports
  set signer_name = v_signer, signature_path = p_signature_path, signed_at = now(), locked_at = now()
  where id = v_report.id;
end;
$$;
revoke all on function werkbank.sign_visit_report(uuid, text, text) from public, anon;
grant execute on function werkbank.sign_visit_report(uuid, text, text) to authenticated;

-- 5. Storage (R3) --------------------------------------------------------------------------------
-- Private bucket; 5 MB and jpeg/png (PHOTO_MAX_BYTES in src/features/werkbank/lib/visitDefaults.ts).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('werkbank-visits', 'werkbank-visits', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Path <org>/<order>/<report>/<file>. The segments are cast to uuid only inside a CASE reached for
-- exactly three uuid-shaped folders, so a malformed path is denied without raising 22P02.
-- Read: admin or producer of the org, or a technician assigned to the order.
create function werkbank.can_read_visit_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_f text[] := storage.foldername(p_name);
  v_org uuid;
  v_order uuid;
begin
  if auth.uid() is null or cardinality(v_f) <> 3
     or not (v_f[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and v_f[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and v_f[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    return false;
  end if;
  v_org := v_f[1]::uuid;
  v_order := v_f[2]::uuid;
  return public.has_org_role(auth.uid(), v_org, 'admin')
    or public.has_org_role(auth.uid(), v_org, 'producer')
    or exists (
      select 1 from werkbank.order_technicians ot
      join public.artists a on a.id = ot.artist_id
      where ot.org_id = v_org and ot.order_id = v_order and a.org_id = v_org and a.user_id = auth.uid()
        and public.is_org_member(auth.uid(), v_org));
end;
$$;
revoke all on function werkbank.can_read_visit_object(text) from public, anon;
grant execute on function werkbank.can_read_visit_object(text) to authenticated;

-- Write (insert): a technician assigned to the order whose report in the path belongs to
-- that order, is unlocked and is authored by them, while the order is neither cancelled nor
-- invoiced. Only the two names the app writes are allowed: <uuid>.jpg and signature.png.
create function werkbank.can_write_visit_object(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_f text[] := storage.foldername(p_name);
begin
  if auth.uid() is null or cardinality(v_f) <> 3
     or not (v_f[1] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and v_f[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and v_f[3] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
     or not (p_name ~* '/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg|signature\.png)$') then
    return false;
  end if;
  return exists (
    select 1
    from werkbank.visit_reports r
    join werkbank.orders o on o.org_id = r.org_id and o.id = r.order_id
    join werkbank.order_technicians ot on ot.org_id = r.org_id and ot.order_id = r.order_id and ot.artist_id = r.artist_id
    join public.artists a on a.id = r.artist_id and a.org_id = r.org_id
    where r.org_id = v_f[1]::uuid and r.order_id = v_f[2]::uuid and r.id = v_f[3]::uuid
      and r.locked_at is null and o.status not in ('cancelled', 'invoiced')
      and a.user_id = auth.uid() and public.is_org_member(auth.uid(), r.org_id));
end;
$$;
revoke all on function werkbank.can_write_visit_object(text) from public, anon;
grant execute on function werkbank.can_write_visit_object(text) to authenticated;

-- Upload room in a report folder (insert only, never delete, so an author can always clean up):
-- 20 photos plus the signature plus a few failed registrations. Bounds unregistered uploads.
create function werkbank.visit_folder_has_room(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from storage.objects s
          where s.bucket_id = 'werkbank-visits'
            and s.name like array_to_string(storage.foldername(p_name), '/') || '/%') < 30;
$$;
revoke all on function werkbank.visit_folder_has_room(text) from public, anon;
grant execute on function werkbank.visit_folder_has_room(text) to authenticated;

-- Delete: as write, and the object is neither a registered photo nor a report's signature, so a
-- report (and its PDF) never points at a missing object. remove_visit_photo deletes the row first
-- and returns the path, so the client's delete afterwards passes.
create function werkbank.can_delete_visit_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select werkbank.can_write_visit_object(p_name)
    and not exists (select 1 from werkbank.visit_report_photos ph where ph.path = p_name)
    and not exists (select 1 from werkbank.visit_reports r where r.signature_path = p_name)
$$;
revoke all on function werkbank.can_delete_visit_object(text) from public, anon;
grant execute on function werkbank.can_delete_visit_object(text) to authenticated;

-- No update policy: an upsert fails, so a signature cannot be replaced.
create policy "Werkbank visit objects read"
  on storage.objects for select to authenticated
  using (case when bucket_id = 'werkbank-visits' then werkbank.can_read_visit_object(name) else false end);
create policy "Werkbank technicians insert visit objects"
  on storage.objects for insert to authenticated
  with check (case when bucket_id = 'werkbank-visits'
    then werkbank.can_write_visit_object(name) and werkbank.visit_folder_has_room(name) else false end);
create policy "Werkbank technicians delete visit objects"
  on storage.objects for delete to authenticated
  using (case when bucket_id = 'werkbank-visits' then werkbank.can_delete_visit_object(name) else false end);
