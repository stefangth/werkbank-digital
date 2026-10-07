-- Werkbank Teil 2: number ranges and automatic customer numbers.
-- Spec: docs/superpowers/specs/2026-10-07-werkbank-stammdaten-design.md (R2).

create table werkbank.number_ranges (
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  prefix text not null default '',
  next_value bigint not null check (next_value > 0),
  padding integer not null default 0 check (padding between 0 and 10),
  primary key (org_id, key)
);

alter table werkbank.number_ranges enable row level security;
grant insert, update on werkbank.number_ranges to authenticated;

create policy number_ranges_select on werkbank.number_ranges for select to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));
create policy number_ranges_insert on werkbank.number_ranges for insert to authenticated
  with check (public.has_org_role(auth.uid(), org_id, 'admin'));
create policy number_ranges_update on werkbank.number_ranges for update to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin'))
  with check (public.has_org_role(auth.uid(), org_id, 'admin'));

-- Returns the next number of a range and advances it. The row lock serialises concurrent callers and
-- the increment commits with the caller's transaction, so a rolled-back insert consumes nothing.
create function werkbank.next_number(p_org uuid, p_key text)
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
  if p_key = 'customer' then
    insert into werkbank.number_ranges (org_id, key, prefix, next_value, padding)
    values (p_org, 'customer', 'K-', 10001, 0)
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

-- Skips numbers already taken in the org (typed by hand, imported, or left behind by a lowered counter), so
-- one such number never blocks automatic numbering. Bounded: after 1000 taken candidates the last one is used
-- and the unique constraint reports the collision.
create function werkbank.assign_customer_no()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_no text;
  v_attempt integer := 0;
begin
  if new.customer_no is null then
    loop
      v_no := werkbank.next_number(new.org_id, 'customer');
      v_attempt := v_attempt + 1;
      exit when v_attempt >= 1000
        or not exists (select 1 from werkbank.customers c where c.org_id = new.org_id and c.customer_no = v_no);
    end loop;
    new.customer_no := v_no;
  end if;
  return new;
end;
$$;

revoke all on function werkbank.assign_customer_no() from public, anon;

create trigger customers_assign_no before insert on werkbank.customers
  for each row execute function werkbank.assign_customer_no();
