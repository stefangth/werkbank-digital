-- Werkbank Teil 3: quote and order locks, transitions, numbering and RPCs.
-- Spec: docs/superpowers/specs/2026-10-07-werkbank-angebot-auftrag-design.md (R2).
--
-- Who is "the user": the lock triggers are SECURITY INVOKER and look at current_user. A request
-- through PostgREST runs as `authenticated` (or `anon`, which has no access to the schema at all);
-- the service role runs as `service_role`; the SECURITY DEFINER RPCs below and every FK action
-- (cascade, set null) run as the table owner. auth.role() cannot tell these apart, because inside a
-- definer RPC the JWT claims still say `authenticated`, so the triggers use current_user instead.
-- Every definer function checks the caller's org role before it writes, so trusting current_user
-- here only trusts code that already did that check.

-- Number ranges: quote and order are seeded on first use, like customer. ------------------
create or replace function werkbank.next_number(p_org uuid, p_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_value bigint;
  v_padding integer;
begin
  if p_key in ('customer', 'quote', 'order') then
    insert into werkbank.number_ranges (org_id, key, prefix, next_value, padding)
    values (
      p_org,
      p_key,
      case p_key when 'customer' then 'K-' when 'quote' then 'A-' else 'AU-' end,
      case p_key when 'customer' then 10001 else 1 end,
      case p_key when 'customer' then 0 else 4 end
    )
    on conflict do nothing;
  end if;

  select prefix, next_value, padding into v_prefix, v_value, v_padding
  from werkbank.number_ranges
  where org_id = p_org and key = p_key
  for update;

  if not found then
    raise exception 'unknown number range %', p_key using errcode = '22023';
  end if;

  update werkbank.number_ranges set next_value = next_value + 1
  where org_id = p_org and key = p_key;

  return v_prefix || lpad(v_value::text, greatest(v_padding, length(v_value::text)), '0');
end;
$$;

revoke all on function werkbank.next_number(uuid, text) from public, anon, authenticated;

-- Quote numbers: only version 1 draws a number; later versions carry the number of the first.
-- Taken numbers are skipped like assign_customer_no does (bounded at 1000 candidates).
create function werkbank.assign_quote_no()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_no text;
  v_attempt integer := 0;
begin
  if new.quote_no is null and new.version = 1 then
    loop
      v_no := werkbank.next_number(new.org_id, 'quote');
      v_attempt := v_attempt + 1;
      exit when v_attempt >= 1000
        or not exists (select 1 from werkbank.quotes q where q.org_id = new.org_id and q.quote_no = v_no);
    end loop;
    new.quote_no := v_no;
  end if;
  return new;
end;
$$;
revoke all on function werkbank.assign_quote_no() from public, anon;

create trigger quotes_assign_no before insert on werkbank.quotes
  for each row execute function werkbank.assign_quote_no();

create function werkbank.assign_order_no()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_no text;
  v_attempt integer := 0;
begin
  if new.order_no is null then
    loop
      v_no := werkbank.next_number(new.org_id, 'order');
      v_attempt := v_attempt + 1;
      exit when v_attempt >= 1000
        or not exists (select 1 from werkbank.orders o where o.org_id = new.org_id and o.order_no = v_no);
    end loop;
    new.order_no := v_no;
  end if;
  return new;
end;
$$;
revoke all on function werkbank.assign_order_no() from public, anon;

create trigger orders_assign_no before insert on werkbank.orders
  for each row execute function werkbank.assign_order_no();

-- Quote lock --------------------------------------------------------------------------
-- On quotes:
--   * Service-only columns (status, send and accept columns, superseded_by, quote_no, version)
--     are never written by a user, at any status. Error 42501 quote_service_only.
--   * Once status <> 'draft', a user may change only valid_until and link_revoked_at; the service
--     side may change the service-only columns too. Everything else raises 55000 quote_locked.
--     FK actions that clear contact_id still run (owner context).
--   * Status transitions: draft -> sent, sent -> accepted | rejected | superseded,
--     rejected -> superseded. Anything else raises 22023 invalid_transition.
-- On document_items with a quote: no insert, update or delete while the quote is not a draft.
-- Items never move to another document (22023 item_reparent). Deletes from FK cascades (owner
-- context) and FK actions that clear catalog_item_id or source_item_id are let through.
create function werkbank.lock_quote()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user boolean := current_user in ('authenticated', 'anon');
  v_service_cols constant text[] := array['status', 'sent_at', 'sent_to', 'pdf_path', 'pdf_sha256',
    'accepted_pdf_path', 'access_token_hash', 'superseded_by', 'quote_no', 'version'];
  v_changed text[];
  v_quote uuid;
  v_status text;
begin
  if tg_table_name = 'document_items' then
    if tg_op = 'UPDATE' and (new.quote_id is distinct from old.quote_id or new.order_id is distinct from old.order_id) then
      raise exception 'item_reparent' using errcode = '22023';
    end if;
    if tg_op = 'DELETE' then
      v_quote := old.quote_id;
    else
      v_quote := new.quote_id;
    end if;
    if v_quote is null or (tg_op = 'DELETE' and not v_user) then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    if tg_op = 'UPDATE' and not v_user then
      v_changed := array(
        select n.key from jsonb_each(to_jsonb(new)) n
        where n.value is distinct from to_jsonb(old) -> n.key and n.key <> 'updated_at'
          and not (n.key in ('catalog_item_id', 'source_item_id') and n.value = 'null'::jsonb));
      if cardinality(v_changed) = 0 then
        return new;
      end if;
    end if;
    select q.status into v_status from werkbank.quotes q where q.id = v_quote;
    if found and v_status <> 'draft' then
      raise exception 'quote_locked' using errcode = '55000';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- werkbank.quotes
  if tg_op = 'INSERT' then
    -- An unknown status is left to the check constraint (23514).
    if v_user and (new.status in ('sent', 'accepted', 'rejected', 'superseded') or new.version <> 1 or new.sent_at is not null or new.sent_to is not null
        or new.pdf_path is not null or new.pdf_sha256 is not null or new.accepted_pdf_path is not null
        or new.access_token_hash is not null or new.superseded_by is not null) then
      raise exception 'quote_service_only' using errcode = '42501';
    end if;
    return new;
  end if;

  v_changed := array(
    select n.key from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from to_jsonb(old) -> n.key and n.key <> 'updated_at');

  if v_user and v_changed && v_service_cols then
    raise exception 'quote_service_only' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'draft' and new.status = 'sent')
    or (old.status = 'sent' and new.status in ('accepted', 'rejected', 'superseded'))
    or (old.status = 'rejected' and new.status = 'superseded')
  ) then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  if old.status <> 'draft' then
    v_changed := array(
      select c from unnest(v_changed) c
      where c not in ('valid_until', 'link_revoked_at')
        and not (not v_user and c = any (v_service_cols))
        and not (not v_user and c = 'contact_id' and new.contact_id is null));
    if cardinality(v_changed) > 0 then
      raise exception 'quote_locked' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function werkbank.lock_quote() from public, anon;

create trigger quotes_lock before insert or update on werkbank.quotes
  for each row execute function werkbank.lock_quote();
create trigger document_items_lock_quote before insert or update or delete on werkbank.document_items
  for each row execute function werkbank.lock_quote();

-- Order transitions and lock ----------------------------------------------------------
-- On orders: a new order starts 'open'. Transitions: open -> in_progress -> done,
-- done -> in_progress (reopen, keeps completed_at), open | in_progress -> cancelled; anything else
-- raises 22023 invalid_transition. completed_at and cancelled_at are stamped here and cannot be
-- written directly. In done and cancelled the header is locked (55000 order_locked); only the
-- status may change. FK actions that clear contact_id still run.
-- On document_items with an order, and on order_technicians: no insert, update or delete while the
-- order is done or cancelled. FK cascades and FK set-null actions are let through.
create function werkbank.order_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user boolean := current_user in ('authenticated', 'anon');
  v_changed text[];
  v_status text;
begin
  if tg_table_name in ('document_items', 'order_technicians') then
    if (tg_op = 'DELETE' and not v_user)
       or (case when tg_op = 'DELETE' then old.order_id else new.order_id end) is null then
      return case when tg_op = 'DELETE' then old else new end;
    end if;
    if tg_op = 'UPDATE' and not v_user then
      v_changed := array(
        select n.key from jsonb_each(to_jsonb(new)) n
        where n.value is distinct from to_jsonb(old) -> n.key and n.key <> 'updated_at'
          and not (n.key in ('catalog_item_id', 'source_item_id') and n.value = 'null'::jsonb));
      if cardinality(v_changed) = 0 then
        return new;
      end if;
    end if;
    if exists (
      select 1 from werkbank.orders o
      where o.status in ('done', 'cancelled')
        and (o.id = case when tg_op = 'DELETE' then old.order_id else new.order_id end
             or (tg_op = 'UPDATE' and o.id = old.order_id))
    ) then
      raise exception 'order_locked' using errcode = '55000';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- werkbank.orders
  if tg_op = 'INSERT' then
    if new.status <> 'open' then
      raise exception 'invalid_transition' using errcode = '22023';
    end if;
    new.completed_at := null;
    new.cancelled_at := null;
    return new;
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'open' and new.status in ('in_progress', 'cancelled'))
    or (old.status = 'in_progress' and new.status in ('done', 'cancelled'))
    or (old.status = 'done' and new.status = 'in_progress')
  ) then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  if old.status in ('done', 'cancelled') then
    v_changed := array(
      select n.key from jsonb_each(to_jsonb(new)) n
      where n.value is distinct from to_jsonb(old) -> n.key
        and n.key not in ('updated_at', 'status', 'completed_at', 'cancelled_at')
        and not (not v_user and n.key = 'contact_id' and n.value = 'null'::jsonb));
    if cardinality(v_changed) > 0 then
      raise exception 'order_locked' using errcode = '55000';
    end if;
  end if;

  new.completed_at := case when new.status = 'done' and old.status <> 'done' then now() else old.completed_at end;
  new.cancelled_at := case when new.status = 'cancelled' and old.status <> 'cancelled' then now() else old.cancelled_at end;
  return new;
end;
$$;
revoke all on function werkbank.order_transition() from public, anon;

create trigger orders_transition before insert or update on werkbank.orders
  for each row execute function werkbank.order_transition();
create trigger document_items_order_lock before insert or update or delete on werkbank.document_items
  for each row execute function werkbank.order_transition();
create trigger order_technicians_order_lock before insert or update or delete on werkbank.order_technicians
  for each row execute function werkbank.order_transition();

-- RPCs --------------------------------------------------------------------------------
-- New version of a sent, rejected or expired (= sent) quote: version n + 1 as a draft with the
-- same number, header and items; the old row becomes superseded and its link is revoked.
create function werkbank.revise_quote(p_quote uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q werkbank.quotes;
  v_id uuid;
begin
  select * into v_q from werkbank.quotes where id = p_quote for update;
  if auth.uid() is null or not found
     or not (public.has_org_role(auth.uid(), v_q.org_id, 'admin') or public.has_org_role(auth.uid(), v_q.org_id, 'producer')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_q.status not in ('sent', 'rejected') then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  insert into werkbank.quotes (org_id, quote_no, version, customer_id, property_id, contact_id, location_note,
    subject, intro_text, closing_text, payment_terms_text, discount_percent, valid_until)
  values (v_q.org_id, v_q.quote_no, v_q.version + 1, v_q.customer_id, v_q.property_id, v_q.contact_id,
    v_q.location_note, v_q.subject, v_q.intro_text, v_q.closing_text, v_q.payment_terms_text,
    v_q.discount_percent, v_q.valid_until)
  returning id into v_id;

  insert into werkbank.document_items (org_id, quote_id, sort_order, kind, name, description, catalog_item_id,
    item_no, quantity, unit_code, labour_price, material_price, vat_rate)
  select i.org_id, v_id, i.sort_order, i.kind, i.name, i.description, i.catalog_item_id,
    i.item_no, i.quantity, i.unit_code, i.labour_price, i.material_price, i.vat_rate
  from werkbank.document_items i
  where i.quote_id = p_quote
  order by i.sort_order;

  update werkbank.quotes
  set status = 'superseded', superseded_by = v_id, link_revoked_at = coalesce(link_revoked_at, now())
  where id = p_quote;

  return v_id;
end;
$$;
revoke all on function werkbank.revise_quote(uuid) from public, anon;
grant execute on function werkbank.revise_quote(uuid) to authenticated;

-- A new draft (version 1, new number) from any quote, optionally for another customer and
-- property. With another customer, a property or contact that does not belong to it is dropped;
-- a given property must belong to the target customer (property trigger). valid_until starts
-- again from today (Berlin) plus the company profile's validity (30 days without a profile).
create function werkbank.copy_quote(p_quote uuid, p_customer uuid default null, p_property uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q werkbank.quotes;
  v_customer uuid;
  v_property uuid;
  v_contact uuid;
  v_days integer;
  v_id uuid;
begin
  select * into v_q from werkbank.quotes where id = p_quote;
  if auth.uid() is null or not found
     or not (public.has_org_role(auth.uid(), v_q.org_id, 'admin') or public.has_org_role(auth.uid(), v_q.org_id, 'producer')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_customer := coalesce(p_customer, v_q.customer_id);
  v_property := coalesce(p_property, case when v_customer = v_q.customer_id then v_q.property_id end);
  select c.id into v_contact from werkbank.contacts c
  where c.id = v_q.contact_id and c.org_id = v_q.org_id
    and (c.customer_id = v_customer or (v_property is not null and c.property_id = v_property));
  select p.quote_validity_days into v_days from werkbank.company_profiles p where p.org_id = v_q.org_id;

  insert into werkbank.quotes (org_id, customer_id, property_id, contact_id, location_note, subject,
    intro_text, closing_text, payment_terms_text, discount_percent, valid_until)
  values (v_q.org_id, v_customer, v_property, v_contact, v_q.location_note, v_q.subject,
    v_q.intro_text, v_q.closing_text, v_q.payment_terms_text, v_q.discount_percent,
    (now() at time zone 'Europe/Berlin')::date + coalesce(v_days, 30))
  returning id into v_id;

  insert into werkbank.document_items (org_id, quote_id, sort_order, kind, name, description, catalog_item_id,
    item_no, quantity, unit_code, labour_price, material_price, vat_rate)
  select i.org_id, v_id, i.sort_order, i.kind, i.name, i.description, i.catalog_item_id,
    i.item_no, i.quantity, i.unit_code, i.labour_price, i.material_price, i.vat_rate
  from werkbank.document_items i
  where i.quote_id = p_quote
  order by i.sort_order;

  return v_id;
end;
$$;
revoke all on function werkbank.copy_quote(uuid, uuid, uuid) from public, anon;
grant execute on function werkbank.copy_quote(uuid, uuid, uuid) to authenticated;

-- An open order from an accepted quote: header and items, each item pointing at its quote line.
-- A second order for the same quote fails on the unique orders.quote_id (23505).
create function werkbank.create_order_from_quote(p_quote uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q werkbank.quotes;
  v_id uuid;
begin
  select * into v_q from werkbank.quotes where id = p_quote;
  if auth.uid() is null or not found
     or not (public.has_org_role(auth.uid(), v_q.org_id, 'admin') or public.has_org_role(auth.uid(), v_q.org_id, 'producer')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_q.status <> 'accepted' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  insert into werkbank.orders (org_id, quote_id, customer_id, property_id, contact_id, location_note, subject,
    discount_percent)
  values (v_q.org_id, v_q.id, v_q.customer_id, v_q.property_id, v_q.contact_id, v_q.location_note, v_q.subject,
    v_q.discount_percent)
  returning id into v_id;

  insert into werkbank.document_items (org_id, order_id, sort_order, kind, name, description, catalog_item_id,
    item_no, quantity, unit_code, labour_price, material_price, vat_rate, source_item_id)
  select i.org_id, v_id, i.sort_order, i.kind, i.name, i.description, i.catalog_item_id,
    i.item_no, i.quantity, i.unit_code, i.labour_price, i.material_price, i.vat_rate, i.id
  from werkbank.document_items i
  where i.quote_id = p_quote
  order by i.sort_order;

  return v_id;
end;
$$;
revoke all on function werkbank.create_order_from_quote(uuid) from public, anon;
grant execute on function werkbank.create_order_from_quote(uuid) to authenticated;
