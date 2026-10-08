-- Werkbank Teil 4: invoice lock, order status 'invoiced', the invoice number range and its guard,
-- and the RPCs create_invoice_from_order, finalize_invoice, cancel_invoice, copy_invoice.
-- Spec: docs/superpowers/specs/2026-10-08-werkbank-rechnung-design.md (R2).
--
-- Contexts as in 20261007190000: the user (`authenticated`, `anon`), the service role
-- (`service_role`, the edge function) and the owner context (the SECURITY DEFINER RPCs below and
-- every FK action). Every definer RPC checks the caller's org role before it writes.

-- Number ranges: invoice (RE-, 1, padding 4) is seeded on first use like quote and order. ------
-- Unlike those, no number is ever skipped: finalize_invoice is the only caller, and its
-- transaction rolls the counter back with everything else when it fails.
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
  if p_key in ('customer', 'quote', 'order', 'invoice') then
    insert into werkbank.number_ranges (org_id, key, prefix, next_value, padding)
    values (
      p_org,
      p_key,
      case p_key when 'customer' then 'K-' when 'quote' then 'A-' when 'order' then 'AU-' else 'RE-' end,
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

-- Invoice range guard -----------------------------------------------------------------------
-- next_value of 'invoice' never decreases. Once the org has an issued (or cancelled) invoice,
-- prefix, padding, key and org cannot change, next_value moves only through next_number (owner
-- context), and the row cannot be deleted. Error 55000 number_range_locked. An org delete (the
-- org row is already gone) passes.
create function werkbank.guard_invoice_range()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_owner boolean := current_user not in ('authenticated', 'anon', 'service_role');
begin
  if not exists (select 1 from public.organizations o where o.id = old.org_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.org_id = old.org_id and new.key = old.key and new.next_value < old.next_value then
    raise exception 'number_range_locked' using errcode = '55000';
  end if;
  if (tg_op = 'DELETE'
      or new.prefix is distinct from old.prefix or new.padding is distinct from old.padding
      or new.key <> old.key or new.org_id <> old.org_id
      or (not v_owner and new.next_value <> old.next_value))
     and exists (select 1 from werkbank.invoices i where i.org_id = old.org_id and i.status <> 'draft') then
    raise exception 'number_range_locked' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function werkbank.guard_invoice_range() from public, anon;

create trigger number_ranges_guard_invoice before update or delete on werkbank.number_ranges
  for each row when (old.key = 'invoice') execute function werkbank.guard_invoice_range();

-- Invoice lock ------------------------------------------------------------------------------
-- On invoices:
--   * Only the owner context (finalize_invoice, cancel_invoice) sets the status, the type and
--     cancels_invoice_id: draft -> issued, issued -> cancelled. Anything else, and a user or the
--     service role inserting a non-draft or a cancellation, raises 22023 invalid_transition.
--   * invoice_no, issue_date, due_date, issued_at and the snapshots are written only by the owner
--     context; pdf_path, pdf_sha256, sent_at and sent_to only by the service role (and the owner
--     context), pdf_path and pdf_sha256 once. Otherwise 55000 invoice_locked.
--   * Once status <> 'draft', nothing else changes: the owner context may only move the status
--     and clear contact_id (FK set-null), the service role only the columns above. A non-draft
--     row is never deleted, except by the cascade of an org delete. 55000 invoice_locked.
--   * pdf_path, pdf_sha256, sent_at and sent_to stay null while the row is a draft.
--   * A cancellation is a full reversal: outside the owner context its order (invalid_transition),
--     customer, property, contact, discount and items (invoice_locked) cannot change, also as a
--     draft. Its texts, service dates and payment_due_days stay editable, and the draft may be
--     deleted.
-- On document_items with an invoice: no insert, update or delete while the invoice is not a
-- draft, or (outside the owner context) when it is a cancellation; FK cascades and FK set-null actions are let through. Items never move to another
-- invoice (22023 item_reparent).
create function werkbank.lock_invoice()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_user boolean := current_user in ('authenticated', 'anon');
  v_service boolean := current_user = 'service_role';
  v_owner boolean := current_user not in ('authenticated', 'anon', 'service_role');
  v_final_cols constant text[] := array['invoice_no', 'issue_date', 'due_date', 'issued_at',
    'seller_snapshot', 'buyer_snapshot'];
  v_service_cols constant text[] := array['pdf_path', 'pdf_sha256', 'sent_at', 'sent_to'];
  v_changed text[];
  v_invoice uuid;
begin
  if tg_table_name = 'document_items' then
    if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
      raise exception 'item_reparent' using errcode = '22023';
    end if;
    v_invoice := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
    if v_invoice is null or (tg_op = 'DELETE' and v_owner) then
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
    -- Share-lock the invoice first, so a concurrent finalize (which holds it for update) either
    -- waits for this item write or has committed and is seen by the check below.
    perform 1 from werkbank.invoices i where i.id = v_invoice for share;
    if exists (select 1 from werkbank.invoices i
               where i.id = v_invoice and (i.status <> 'draft' or (i.type = 'cancellation' and not v_owner))) then
      raise exception 'invoice_locked' using errcode = '55000';
    end if;
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  -- werkbank.invoices
  if tg_op = 'DELETE' then
    if old.status <> 'draft'
       and not (v_owner and not exists (select 1 from public.organizations o where o.id = old.org_id)) then
      raise exception 'invoice_locked' using errcode = '55000';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if not v_owner then
      -- An unknown status or type is left to the check constraints (23514).
      if new.status in ('issued', 'cancelled') or new.type = 'cancellation' or new.cancels_invoice_id is not null then
        raise exception 'invalid_transition' using errcode = '22023';
      end if;
      if new.invoice_no is not null or new.issue_date is not null or new.due_date is not null
         or new.issued_at is not null or new.seller_snapshot is not null or new.buyer_snapshot is not null
         or new.pdf_path is not null or new.pdf_sha256 is not null or new.sent_at is not null
         or new.sent_to is not null then
        raise exception 'invoice_locked' using errcode = '55000';
      end if;
    end if;
    return new;
  end if;

  v_changed := array(
    select n.key from jsonb_each(to_jsonb(new)) n
    where n.value is distinct from to_jsonb(old) -> n.key and n.key <> 'updated_at');

  if not v_owner and (v_changed && array['type', 'cancels_invoice_id']
      or (old.type = 'cancellation' and 'order_id' = any (v_changed))) then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if new.status is distinct from old.status and not (
    v_owner and ((old.status = 'draft' and new.status = 'issued') or (old.status = 'issued' and new.status = 'cancelled'))
  ) then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;
  if (not v_owner and v_changed && v_final_cols)
     or (v_user and v_changed && v_service_cols)
     or (not v_owner and old.status = 'draft' and v_changed && v_service_cols)
     or (not v_owner and old.type = 'cancellation'
         and v_changed && array['customer_id', 'property_id', 'contact_id', 'discount_percent'])
     or (old.pdf_path is not null and new.pdf_path is distinct from old.pdf_path)
     or (old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256) then
    raise exception 'invoice_locked' using errcode = '55000';
  end if;

  if old.status <> 'draft' then
    v_changed := array(
      select c from unnest(v_changed) c
      where not (v_owner and c = 'status')
        and not (v_owner and c = 'contact_id' and new.contact_id is null)
        and not (v_service and c = any (v_service_cols)));
    if cardinality(v_changed) > 0 then
      raise exception 'invoice_locked' using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function werkbank.lock_invoice() from public, anon;

create trigger invoices_lock before insert or update or delete on werkbank.invoices
  for each row execute function werkbank.lock_invoice();
create trigger document_items_lock_invoice before insert or update or delete on werkbank.document_items
  for each row execute function werkbank.lock_invoice();

-- A delete of an issued invoice must reach the lock trigger and raise invoice_locked instead of
-- silently matching no row, so the delete policy no longer filters on the status.
drop policy invoices_delete on werkbank.invoices;
create policy invoices_delete on werkbank.invoices for delete to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));

-- Order transitions with 'invoiced' -----------------------------------------------------------
-- As in 20261007190000, plus: done -> invoiced and invoiced -> done only in the owner context
-- (finalize_invoice); invoiced is locked like done (header, items, technicians); no other
-- transition into or out of invoiced. completed_at survives done -> invoiced -> done.
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
        and n.key not in ('updated_at', 'status', 'completed_at', 'cancelled_at')
        and not (v_owner and n.key = 'contact_id' and n.value = 'null'::jsonb)
        and n.key not in (select a.attname from pg_catalog.pg_attribute a where a.attrelid = tg_relid and a.attgenerated <> ''));
    if cardinality(v_changed) > 0 then
      raise exception 'order_locked' using errcode = '55000';
    end if;
  end if;

  new.completed_at := case when new.status = 'done' and old.status not in ('done', 'invoiced') then now()
    else old.completed_at end;
  new.cancelled_at := case when new.status = 'cancelled' and old.status <> 'cancelled' then now() else old.cancelled_at end;
  return new;
end;
$$;
revoke all on function werkbank.order_transition() from public, anon;

-- RPCs --------------------------------------------------------------------------------------
-- Each checks the caller's role (admin or producer of the row's org) before it locks or writes.

-- A draft invoice from a done order: header and items (each pointing at its order line), texts
-- and payment_due_days from the company profile, service_date_from = Berlin date of completed_at.
-- A second active invoice for the order fails on invoices_one_active_per_order (23505).
create function werkbank.create_invoice_from_order(p_order uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_o werkbank.orders;
  v_p werkbank.company_profiles;
  v_id uuid;
begin
  select o.org_id into v_org from werkbank.orders o where o.id = p_order;
  if auth.uid() is null or not found
     or not (public.has_org_role(auth.uid(), v_org, 'admin') or public.has_org_role(auth.uid(), v_org, 'producer')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_o from werkbank.orders where id = p_order for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_o.status <> 'done' then
    raise exception 'order_not_done' using errcode = '22023';
  end if;
  select * into v_p from werkbank.company_profiles p where p.org_id = v_o.org_id;

  insert into werkbank.invoices (org_id, type, order_id, customer_id, property_id, contact_id, location_note,
    subject, discount_percent, intro_text, closing_text, payment_terms_text, service_date_from, payment_due_days)
  values (v_o.org_id, 'invoice', v_o.id, v_o.customer_id, v_o.property_id, v_o.contact_id, v_o.location_note,
    v_o.subject, v_o.discount_percent, v_p.invoice_intro, v_p.invoice_closing, v_p.payment_terms_text,
    (v_o.completed_at at time zone 'Europe/Berlin')::date, coalesce(v_p.payment_due_days, 14))
  returning id into v_id;

  insert into werkbank.document_items (org_id, invoice_id, sort_order, kind, name, description, catalog_item_id,
    item_no, quantity, unit_code, labour_price, material_price, vat_rate, source_item_id)
  select i.org_id, v_id, i.sort_order, i.kind, i.name, i.description, i.catalog_item_id,
    i.item_no, i.quantity, i.unit_code, i.labour_price, i.material_price, i.vat_rate, i.id
  from werkbank.document_items i
  where i.order_id = p_order
  order by i.sort_order;

  return v_id;
end;
$$;
revoke all on function werkbank.create_invoice_from_order(uuid) from public, anon;
grant execute on function werkbank.create_invoice_from_order(uuid) to authenticated;

-- Issue a draft. Order of work: lock the row, require draft, collect the blockers and raise
-- invoice_not_ready (detail: comma-separated, in the order no_items, no_service_date,
-- profile_incomplete, no_buyer_address), require the order (of an invoice) to be done, and only
-- then draw the number, so a failed issue never touches the range. A cancellation copies the
-- original's buyer_snapshot; its seller_snapshot is taken fresh. Then stamp the dates and the
-- snapshots and move the linked documents: invoice with order: order done -> invoiced;
-- cancellation: original issued -> cancelled, its order invoiced -> done.
-- Snapshots: seller = the company profile row without org_id, created_at, updated_at. buyer =
-- { name, street, postal_code, city, country_code, customer_no, vat_id, invoice_email, is_private,
--   billing_override, property: { name, street, postal_code, city } | null }, the address from
-- the property's billing_* fields when set, else from the customer (name as customerDisplayName
-- in src/features/werkbank/lib/displayName.ts).
create function werkbank.finalize_invoice(p_invoice uuid)
returns werkbank.invoices
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_inv werkbank.invoices;
  v_orig werkbank.invoices;
  v_order_status text;
  v_p werkbank.company_profiles;
  v_c werkbank.customers;
  v_prop werkbank.properties;
  v_override boolean;
  v_buyer jsonb;
  v_blockers text[] := array[]::text[];
  v_today date := (now() at time zone 'Europe/Berlin')::date;
begin
  select i.org_id into v_org from werkbank.invoices i where i.id = p_invoice;
  if auth.uid() is null or not found
     or not (public.has_org_role(auth.uid(), v_org, 'admin') or public.has_org_role(auth.uid(), v_org, 'producer')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_inv from werkbank.invoices where id = p_invoice for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_inv.status <> 'draft' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  select * into v_p from werkbank.company_profiles p where p.org_id = v_inv.org_id;
  select * into v_c from werkbank.customers c where c.id = v_inv.customer_id;
  if v_inv.property_id is not null then
    select * into v_prop from werkbank.properties p where p.id = v_inv.property_id;
  end if;
  v_override := v_prop.billing_name is not null;
  v_buyer := jsonb_build_object(
    'name', case when v_override then v_prop.billing_name
                 when v_c.kind = 'property_manager' then coalesce(v_c.company_name, '')
                 else coalesce(v_c.last_name, '')
                   || case when coalesce(v_c.first_name, '') <> '' then ', ' || v_c.first_name else '' end end,
    'street', case when v_override then v_prop.billing_street else v_c.street end,
    'postal_code', case when v_override then v_prop.billing_postal_code else v_c.postal_code end,
    'city', case when v_override then v_prop.billing_city else v_c.city end,
    'country_code', case when v_override then v_prop.billing_country_code else v_c.country_code end,
    'customer_no', v_c.customer_no,
    'vat_id', v_c.vat_id,
    'invoice_email', v_c.invoice_email,
    'is_private', v_c.kind = 'private',
    'billing_override', v_override,
    'property', case when v_prop.id is null then null
      else jsonb_build_object('name', v_prop.name, 'street', v_prop.street,
        'postal_code', v_prop.postal_code, 'city', v_prop.city) end);

  if not exists (select 1 from werkbank.document_items i where i.invoice_id = p_invoice and i.kind = 'item') then
    v_blockers := array_append(v_blockers, 'no_items');
  end if;
  if v_inv.service_date_from is null then
    v_blockers := array_append(v_blockers, 'no_service_date');
  end if;
  if v_p.org_id is null
     or btrim(coalesce(v_p.company_name, '')) = '' or btrim(coalesce(v_p.street, '')) = ''
     or btrim(coalesce(v_p.postal_code, '')) = '' or btrim(coalesce(v_p.city, '')) = ''
     or btrim(coalesce(v_p.email, '')) = ''
     or (btrim(coalesce(v_p.tax_number, '')) = '' and btrim(coalesce(v_p.vat_id, '')) = '')
     or btrim(coalesce(v_p.iban, '')) = '' then
    v_blockers := array_append(v_blockers, 'profile_incomplete');
  end if;
  -- A cancellation takes the original's buyer_snapshot (R8), so the current address does not matter.
  if v_inv.type <> 'cancellation' and (
     btrim(coalesce(v_buyer ->> 'name', '')) = '' or btrim(coalesce(v_buyer ->> 'street', '')) = ''
     or btrim(coalesce(v_buyer ->> 'postal_code', '')) = '' or btrim(coalesce(v_buyer ->> 'city', '')) = '') then
    v_blockers := array_append(v_blockers, 'no_buyer_address');
  end if;
  if cardinality(v_blockers) > 0 then
    raise exception 'invoice_not_ready' using errcode = '22023', detail = array_to_string(v_blockers, ',');
  end if;

  if v_inv.type = 'cancellation' then
    select * into v_orig from werkbank.invoices where id = v_inv.cancels_invoice_id for update;
    if v_orig.status is distinct from 'issued' then
      raise exception 'invalid_transition' using errcode = '22023';
    end if;
  elsif v_inv.order_id is not null then
    select o.status into v_order_status from werkbank.orders o where o.id = v_inv.order_id for update;
    if v_order_status is distinct from 'done' then
      raise exception 'order_not_done' using errcode = '22023';
    end if;
  end if;

  update werkbank.invoices
  set invoice_no = werkbank.next_number(v_inv.org_id, 'invoice'),
    issue_date = v_today,
    due_date = v_today + v_inv.payment_due_days,
    issued_at = now(),
    status = 'issued',
    seller_snapshot = to_jsonb(v_p) - 'org_id' - 'created_at' - 'updated_at',
    -- A cancellation reverses the original towards the same buyer.
    buyer_snapshot = case when v_inv.type = 'cancellation' then v_orig.buyer_snapshot else v_buyer end
  where id = p_invoice
  returning * into v_inv;

  if v_inv.type = 'cancellation' then
    update werkbank.invoices set status = 'cancelled' where id = v_orig.id;
    if v_orig.order_id is not null then
      update werkbank.orders set status = 'done' where id = v_orig.order_id and status = 'invoiced';
    end if;
  elsif v_inv.order_id is not null then
    update werkbank.orders set status = 'invoiced' where id = v_inv.order_id;
  end if;

  return v_inv;
end;
$$;
revoke all on function werkbank.finalize_invoice(uuid) from public, anon;
grant execute on function werkbank.finalize_invoice(uuid) to authenticated;

-- A cancellation draft of an issued invoice: its header, order, service dates and items (each
-- pointing at the original line), intro "Storno zu RE-0012 vom 08.10.2026". A second
-- cancellation fails on invoices_cancels_invoice_id_key (23505); the draft may be deleted again.
create function werkbank.cancel_invoice(p_invoice uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_inv werkbank.invoices;
  v_id uuid;
begin
  select i.org_id into v_org from werkbank.invoices i where i.id = p_invoice;
  if auth.uid() is null or not found
     or not (public.has_org_role(auth.uid(), v_org, 'admin') or public.has_org_role(auth.uid(), v_org, 'producer')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_inv from werkbank.invoices where id = p_invoice for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_inv.type <> 'invoice' or v_inv.status <> 'issued' then
    raise exception 'invalid_transition' using errcode = '22023';
  end if;

  insert into werkbank.invoices (org_id, type, cancels_invoice_id, order_id, customer_id, property_id, contact_id,
    location_note, subject, discount_percent, intro_text, closing_text, payment_terms_text,
    service_date_from, service_date_to, payment_due_days)
  values (v_inv.org_id, 'cancellation', v_inv.id, v_inv.order_id, v_inv.customer_id, v_inv.property_id,
    v_inv.contact_id, v_inv.location_note, v_inv.subject, v_inv.discount_percent,
    -- German on purpose: invoices and their PDFs are German-only in V1 (spec non-goals), and the
    -- text is stored on the document, so it cannot follow the UI language anyway.
    'Storno zu ' || v_inv.invoice_no || ' vom ' || to_char(v_inv.issue_date, 'DD.MM.YYYY'),
    v_inv.closing_text, v_inv.payment_terms_text, v_inv.service_date_from, v_inv.service_date_to,
    v_inv.payment_due_days)
  returning id into v_id;

  insert into werkbank.document_items (org_id, invoice_id, sort_order, kind, name, description, catalog_item_id,
    item_no, quantity, unit_code, labour_price, material_price, vat_rate, source_item_id)
  select i.org_id, v_id, i.sort_order, i.kind, i.name, i.description, i.catalog_item_id,
    i.item_no, i.quantity, i.unit_code, i.labour_price, i.material_price, i.vat_rate, i.id
  from werkbank.document_items i
  where i.invoice_id = p_invoice
  order by i.sort_order;

  return v_id;
end;
$$;
revoke all on function werkbank.cancel_invoice(uuid) from public, anon;
grant execute on function werkbank.cancel_invoice(uuid) to authenticated;

-- A new invoice draft with the header and items of any invoice (also a cancelled one or a
-- cancellation). order_id is kept only while that order is done and has no active invoice; then
-- the items of an invoice keep their order-line provenance too.
create function werkbank.copy_invoice(p_invoice uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_inv werkbank.invoices;
  v_order uuid;
  v_id uuid;
begin
  select i.org_id into v_org from werkbank.invoices i where i.id = p_invoice;
  if auth.uid() is null or not found
     or not (public.has_org_role(auth.uid(), v_org, 'admin') or public.has_org_role(auth.uid(), v_org, 'producer')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_inv from werkbank.invoices where id = p_invoice;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  select o.id into v_order from werkbank.orders o
  where o.id = v_inv.order_id and o.status = 'done'
    and not exists (
      select 1 from werkbank.invoices a
      where a.order_id = o.id and a.type = 'invoice' and a.status <> 'cancelled');

  insert into werkbank.invoices (org_id, type, order_id, customer_id, property_id, contact_id, location_note,
    subject, discount_percent, intro_text, closing_text, payment_terms_text, service_date_from, service_date_to,
    payment_due_days)
  values (v_inv.org_id, 'invoice', v_order, v_inv.customer_id, v_inv.property_id, v_inv.contact_id,
    v_inv.location_note, v_inv.subject, v_inv.discount_percent, v_inv.intro_text, v_inv.closing_text,
    v_inv.payment_terms_text, v_inv.service_date_from, v_inv.service_date_to, v_inv.payment_due_days)
  returning id into v_id;

  insert into werkbank.document_items (org_id, invoice_id, sort_order, kind, name, description, catalog_item_id,
    item_no, quantity, unit_code, labour_price, material_price, vat_rate, source_item_id)
  select i.org_id, v_id, i.sort_order, i.kind, i.name, i.description, i.catalog_item_id,
    i.item_no, i.quantity, i.unit_code, i.labour_price, i.material_price, i.vat_rate,
    case when v_order is not null and v_inv.type = 'invoice' then i.source_item_id end
  from werkbank.document_items i
  where i.invoice_id = p_invoice
  order by i.sort_order;

  return v_id;
end;
$$;
revoke all on function werkbank.copy_invoice(uuid) from public, anon;
grant execute on function werkbank.copy_invoice(uuid) to authenticated;
