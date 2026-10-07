-- Werkbank Teil 2: bulk import RPCs for customers, properties and catalog items.
-- Spec: docs/superpowers/specs/2026-10-07-werkbank-stammdaten-design.md (import).
-- Input is a JSON array of objects keyed by column name; the result has one entry per row, in order:
--   {"row": <0-based index>, "status": "created" | "skipped" | "error", "reason": ..., "detail": ...}
-- The functions are security definer, so RLS does not apply: each one checks the caller's role first and
-- forces org_id := p_org. Keys id, org_id, created_at, updated_at, archived_at and net_price in the JSON are
-- ignored. Every row runs in its own subtransaction, so one bad row never aborts the batch. Columns with a
-- default (country_code, payment_terms_days, prices, vat_rate) are coalesced because jsonb_populate_record
-- yields NULL for missing keys.

create function werkbank.import_customers(p_org uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_i bigint;
  v_row jsonb;
  v_rec werkbank.customers;
  v_constraint text;
  v_msg text;
begin
  if auth.uid() is null
     or not (public.has_org_role(auth.uid(), p_org, 'admin') or public.has_org_role(auth.uid(), p_org, 'producer')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;

  -- Make sure the range exists without consuming a number.
  insert into werkbank.number_ranges (org_id, key, prefix, next_value, padding)
  values (p_org, 'customer', 'K-', 10001, 0)
  on conflict do nothing;

  for v_i, v_row in select o - 1, e from jsonb_array_elements(p_rows) with ordinality as t(e, o) loop
    begin
      if jsonb_typeof(v_row) <> 'object' then
        v_out := v_out || jsonb_build_object('row', v_i, 'status', 'error', 'reason', 'invalid', 'detail', 'row is not an object');
        continue;
      end if;
      v_rec := jsonb_populate_record(null::werkbank.customers, v_row);
      insert into werkbank.customers (
        org_id, customer_no, kind, company_name, first_name, last_name, street, postal_code, city,
        country_code, email, invoice_email, phone, vat_id, payment_terms_days, notes
      ) values (
        p_org, nullif(btrim(v_rec.customer_no), ''), v_rec.kind, v_rec.company_name, v_rec.first_name, v_rec.last_name,
        v_rec.street, v_rec.postal_code, v_rec.city, coalesce(v_rec.country_code, 'DE'), v_rec.email,
        v_rec.invoice_email, v_rec.phone, v_rec.vat_id, coalesce(v_rec.payment_terms_days, 14), v_rec.notes
      );
      v_out := v_out || jsonb_build_object('row', v_i, 'status', 'created', 'reason', null, 'detail', null);
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'customers_customer_no_unique' then
          v_out := v_out || jsonb_build_object('row', v_i, 'status', 'skipped', 'reason', 'customer_no_taken', 'detail', v_constraint);
        else
          v_out := v_out || jsonb_build_object('row', v_i, 'status', 'error', 'reason', 'invalid', 'detail', coalesce(v_constraint, sqlerrm));
        end if;
      when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
        get stacked diagnostics v_constraint = constraint_name, v_msg = message_text;
        v_out := v_out || jsonb_build_object('row', v_i, 'status', 'error', 'reason', 'invalid', 'detail', coalesce(v_constraint, v_msg));
    end;
  end loop;

  -- Raise the range above the highest imported number that fits the prefix pattern.
  update werkbank.number_ranges nr set next_value = greatest(nr.next_value, m.max_no + 1)
  from (select max(substr(c.customer_no, length(nr2.prefix) + 1)::bigint) as max_no
        from werkbank.customers c join werkbank.number_ranges nr2 on nr2.org_id = c.org_id and nr2.key = 'customer'
        where c.org_id = p_org and left(c.customer_no, length(nr2.prefix)) = nr2.prefix
          and substr(c.customer_no, length(nr2.prefix) + 1) ~ '^[0-9]{1,18}$') m
  where nr.org_id = p_org and nr.key = 'customer' and m.max_no is not null;

  return v_out;
end;
$$;

create function werkbank.import_properties(p_org uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_i bigint;
  v_row jsonb;
  v_rec werkbank.properties;
  v_customer uuid;
  v_constraint text;
  v_msg text;
begin
  if auth.uid() is null
     or not (public.has_org_role(auth.uid(), p_org, 'admin') or public.has_org_role(auth.uid(), p_org, 'producer')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;

  for v_i, v_row in select o - 1, e from jsonb_array_elements(p_rows) with ordinality as t(e, o) loop
    begin
      if jsonb_typeof(v_row) <> 'object' then
        v_out := v_out || jsonb_build_object('row', v_i, 'status', 'error', 'reason', 'invalid', 'detail', 'row is not an object');
        continue;
      end if;

      select c.id into v_customer from werkbank.customers c
      where c.org_id = p_org and c.customer_no = v_row->>'customer_no';
      if v_customer is null then
        v_out := v_out || jsonb_build_object('row', v_i, 'status', 'error', 'reason', 'unknown_customer', 'detail', v_row->>'customer_no');
        continue;
      end if;

      v_rec := jsonb_populate_record(null::werkbank.properties, v_row);
      insert into werkbank.properties (
        org_id, customer_id, name, object_no, street, postal_code, city, country_code,
        billing_name, billing_street, billing_postal_code, billing_city, billing_country_code, access_notes, notes
      ) values (
        p_org, v_customer, v_rec.name, v_rec.object_no, v_rec.street, v_rec.postal_code, v_rec.city,
        coalesce(v_rec.country_code, 'DE'), v_rec.billing_name, v_rec.billing_street, v_rec.billing_postal_code,
        v_rec.billing_city, v_rec.billing_country_code, v_rec.access_notes, v_rec.notes
      );
      v_out := v_out || jsonb_build_object('row', v_i, 'status', 'created', 'reason', null, 'detail', null);
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        v_out := v_out || jsonb_build_object('row', v_i, 'status', 'error', 'reason', 'invalid', 'detail', coalesce(v_constraint, sqlerrm));
      when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
        get stacked diagnostics v_constraint = constraint_name, v_msg = message_text;
        v_out := v_out || jsonb_build_object('row', v_i, 'status', 'error', 'reason', 'invalid', 'detail', coalesce(v_constraint, v_msg));
    end;
  end loop;

  return v_out;
end;
$$;

create function werkbank.import_catalog_items(p_org uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_i bigint;
  v_row jsonb;
  v_rec werkbank.catalog_items;
  v_constraint text;
  v_msg text;
begin
  if auth.uid() is null
     or not (public.has_org_role(auth.uid(), p_org, 'admin') or public.has_org_role(auth.uid(), p_org, 'producer')) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a JSON array' using errcode = '22023';
  end if;

  for v_i, v_row in select o - 1, e from jsonb_array_elements(p_rows) with ordinality as t(e, o) loop
    begin
      if jsonb_typeof(v_row) <> 'object' then
        v_out := v_out || jsonb_build_object('row', v_i, 'status', 'error', 'reason', 'invalid', 'detail', 'row is not an object');
        continue;
      end if;
      -- net_price is generated: drop it before populating so it can never be set.
      v_rec := jsonb_populate_record(null::werkbank.catalog_items, v_row - 'net_price');
      insert into werkbank.catalog_items (
        org_id, item_no, name, description, category, unit_code, labour_price, material_price, vat_rate
      ) values (
        p_org, nullif(btrim(v_rec.item_no), ''), v_rec.name, v_rec.description, v_rec.category, v_rec.unit_code,
        coalesce(v_rec.labour_price, 0), coalesce(v_rec.material_price, 0), coalesce(v_rec.vat_rate, 19)
      );
      v_out := v_out || jsonb_build_object('row', v_i, 'status', 'created', 'reason', null, 'detail', null);
    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'catalog_items_item_no_unique' then
          v_out := v_out || jsonb_build_object('row', v_i, 'status', 'skipped', 'reason', 'item_no_taken', 'detail', v_constraint);
        else
          v_out := v_out || jsonb_build_object('row', v_i, 'status', 'error', 'reason', 'invalid', 'detail', coalesce(v_constraint, sqlerrm));
        end if;
      when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
        get stacked diagnostics v_constraint = constraint_name, v_msg = message_text;
        v_out := v_out || jsonb_build_object('row', v_i, 'status', 'error', 'reason', 'invalid', 'detail', coalesce(v_constraint, v_msg));
    end;
  end loop;

  return v_out;
end;
$$;

revoke all on function werkbank.import_customers(uuid, jsonb) from public, anon;
revoke all on function werkbank.import_properties(uuid, jsonb) from public, anon;
revoke all on function werkbank.import_catalog_items(uuid, jsonb) from public, anon;
grant execute on function werkbank.import_customers(uuid, jsonb) to authenticated;
grant execute on function werkbank.import_properties(uuid, jsonb) to authenticated;
grant execute on function werkbank.import_catalog_items(uuid, jsonb) to authenticated;
