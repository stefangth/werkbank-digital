-- Werkbank Teil 2: re-importing a properties file must not create duplicates.
-- Spec: docs/superpowers/specs/2026-10-07-werkbank-stammdaten-design.md (R7).
-- Properties have no natural key, so import_properties now skips a row (status 'skipped', reason
-- 'property_exists', detail = id of the existing property) when the org already has a property of the same
-- customer with the same normalized address: street, postal_code and city, each with every whitespace run
-- collapsed to one space, trimmed and lowercased. Archived properties count. The check runs before the
-- insert and sees the rows inserted earlier in the same call, so duplicates inside one file are skipped too.
-- There is deliberately no unique constraint: manual entry of similar properties stays possible.
-- A per-org advisory lock serializes concurrent property imports so two parallel calls cannot both insert
-- the same address. Everything else is unchanged from 20261007160000_werkbank_import_rpcs.sql.

create or replace function werkbank.import_properties(p_org uuid, p_rows jsonb)
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
  v_existing uuid;
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('werkbank.import_properties:' || p_org::text, 0));

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

      -- Duplicate check: same customer and same normalized street, postal code and city in this org.
      v_existing := null;
      select p.id into v_existing from werkbank.properties p
      where p.org_id = p_org and p.customer_id = v_customer
        and lower(btrim(regexp_replace(p.street, '\s+', ' ', 'g')))
          = lower(btrim(regexp_replace(v_rec.street, '\s+', ' ', 'g')))
        and lower(btrim(regexp_replace(p.postal_code, '\s+', ' ', 'g')))
          = lower(btrim(regexp_replace(v_rec.postal_code, '\s+', ' ', 'g')))
        and lower(btrim(regexp_replace(p.city, '\s+', ' ', 'g')))
          = lower(btrim(regexp_replace(v_rec.city, '\s+', ' ', 'g')))
      order by p.created_at, p.id
      limit 1;
      if v_existing is not null then
        v_out := v_out || jsonb_build_object('row', v_i, 'status', 'skipped', 'reason', 'property_exists', 'detail', v_existing);
        continue;
      end if;

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

revoke all on function werkbank.import_properties(uuid, jsonb) from public, anon;
grant execute on function werkbank.import_properties(uuid, jsonb) to authenticated;
