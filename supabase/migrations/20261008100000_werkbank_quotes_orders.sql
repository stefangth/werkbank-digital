-- Werkbank Teil 3: quotes, orders, order technicians, document items, company profile, acceptances.
-- Spec: docs/superpowers/specs/2026-10-07-werkbank-angebot-auftrag-design.md (R1).
-- Lock and status triggers, number assignment, RPCs, views and storage follow in later migrations.
-- Same conventions as master data: composite FKs over (org_id, id), RLS for admin and producer.

-- contacts gets the (org_id, id) key the document FKs need (master data only had it on customers
-- and properties).
alter table werkbank.contacts add constraint contacts_org_id_id_key unique (org_id, id);

-- company_profiles --------------------------------------------------------------------
create table werkbank.company_profiles (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  company_name text not null check (btrim(company_name) <> ''),
  legal_form text,
  street text not null check (btrim(street) <> ''),
  postal_code text not null check (btrim(postal_code) <> ''),
  city text not null check (btrim(city) <> ''),
  country_code text not null default 'DE' check (country_code ~ '^[A-Z]{2}$'),
  phone text,
  email text check (email ~ '^[^@\s]+@[^@\s]+$'),
  website text,
  tax_number text,
  vat_id text check (vat_id ~ '^[A-Z]{2}[0-9A-Za-z+*.]{2,12}$'),
  register_court text,
  register_number text,
  iban text check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  bic text,
  bank_name text,
  logo_path text,
  quote_intro text,
  quote_closing text,
  payment_terms_text text,
  quote_validity_days integer not null default 30 check (quote_validity_days between 1 and 365),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_profiles_de_postal_code
    check (country_code <> 'DE' or postal_code ~ '^[0-9]{5}$')
);
create trigger company_profiles_set_updated_at before update on werkbank.company_profiles
  for each row execute function public.update_updated_at_column();

-- quotes ------------------------------------------------------------------------------
create table werkbank.quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  quote_no text not null,
  version integer not null default 1 check (version >= 1),
  superseded_by uuid,
  customer_id uuid not null,
  property_id uuid,
  contact_id uuid,
  location_note text,
  subject text,
  intro_text text,
  closing_text text,
  payment_terms_text text,
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  valid_until date not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'accepted', 'rejected', 'superseded')),
  sent_at timestamptz,
  sent_to text[],
  pdf_path text,
  pdf_sha256 text,
  accepted_pdf_path text,
  access_token_hash text unique,
  link_revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quotes_org_id_id_key unique (org_id, id),
  constraint quotes_no_version_key unique (org_id, quote_no, version),
  constraint quotes_superseded_by_fk foreign key (org_id, superseded_by)
    references werkbank.quotes (org_id, id) on delete set null (superseded_by),
  constraint quotes_customer_fk foreign key (org_id, customer_id)
    references werkbank.customers (org_id, id) on delete no action,
  constraint quotes_property_fk foreign key (org_id, property_id)
    references werkbank.properties (org_id, id) on delete no action,
  constraint quotes_contact_fk foreign key (org_id, contact_id)
    references werkbank.contacts (org_id, id) on delete set null (contact_id)
);
create index quotes_org_id_idx on werkbank.quotes (org_id);
create index quotes_org_customer_idx on werkbank.quotes (org_id, customer_id);
create index quotes_org_status_idx on werkbank.quotes (org_id, status);
create trigger quotes_set_updated_at before update on werkbank.quotes
  for each row execute function public.update_updated_at_column();

-- orders ------------------------------------------------------------------------------
create table werkbank.orders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_no text not null,
  quote_id uuid unique,
  customer_id uuid not null,
  property_id uuid,
  contact_id uuid,
  location_note text,
  subject text,
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  notes text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  scheduled_date date,
  scheduled_time time,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_org_id_id_key unique (org_id, id),
  constraint orders_order_no_unique unique (org_id, order_no),
  constraint orders_time_needs_date check (scheduled_time is null or scheduled_date is not null),
  constraint orders_quote_fk foreign key (org_id, quote_id)
    references werkbank.quotes (org_id, id) on delete no action,
  constraint orders_customer_fk foreign key (org_id, customer_id)
    references werkbank.customers (org_id, id) on delete no action,
  constraint orders_property_fk foreign key (org_id, property_id)
    references werkbank.properties (org_id, id) on delete no action,
  constraint orders_contact_fk foreign key (org_id, contact_id)
    references werkbank.contacts (org_id, id) on delete set null (contact_id)
);
create index orders_org_id_idx on werkbank.orders (org_id);
create index orders_org_customer_idx on werkbank.orders (org_id, customer_id);
create index orders_org_status_idx on werkbank.orders (org_id, status);
create index orders_org_scheduled_idx on werkbank.orders (org_id, scheduled_date);
create trigger orders_set_updated_at before update on werkbank.orders
  for each row execute function public.update_updated_at_column();

-- order_technicians -------------------------------------------------------------------
create table werkbank.order_technicians (
  org_id uuid not null references public.organizations(id) on delete cascade,
  order_id uuid not null,
  artist_id uuid not null references public.artists(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (order_id, artist_id),
  constraint order_technicians_order_fk foreign key (org_id, order_id)
    references werkbank.orders (org_id, id) on delete cascade
);
create index order_technicians_org_id_idx on werkbank.order_technicians (org_id);
create index order_technicians_artist_id_idx on werkbank.order_technicians (artist_id);
create trigger order_technicians_set_updated_at before update on werkbank.order_technicians
  for each row execute function public.update_updated_at_column();

-- document_items ----------------------------------------------------------------------
create table werkbank.document_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid,
  order_id uuid,
  sort_order integer not null,
  kind text not null check (kind in ('title', 'item', 'text')),
  name text,
  description text,
  catalog_item_id uuid references werkbank.catalog_items(id) on delete set null,
  item_no text,
  quantity numeric(12,3),
  unit_code text check (unit_code in ('HUR', 'H87', 'MTR', 'MTK', 'MTQ', 'KGM', 'LTR', 'LS')),
  labour_price numeric(12,2) check (labour_price >= 0),
  material_price numeric(12,2) check (material_price >= 0),
  vat_rate numeric(4,2) check (vat_rate in (19, 7, 0)),
  line_net numeric(12,2) generated always as (round(quantity * (labour_price + material_price), 2)) stored,
  source_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_items_org_id_id_key unique (org_id, id),
  constraint document_items_one_parent check (num_nonnulls(quote_id, order_id) = 1),
  constraint document_items_quote_fk foreign key (org_id, quote_id)
    references werkbank.quotes (org_id, id) on delete cascade,
  constraint document_items_order_fk foreign key (org_id, order_id)
    references werkbank.orders (org_id, id) on delete cascade,
  constraint document_items_source_fk foreign key (org_id, source_item_id)
    references werkbank.document_items (org_id, id) on delete set null (source_item_id),
  constraint document_items_kind_fields check (
    case kind
      when 'item' then
        btrim(coalesce(name, '')) <> '' and quantity is not null and quantity > 0 and unit_code is not null
        and labour_price is not null and material_price is not null and vat_rate is not null
      when 'title' then
        btrim(coalesce(name, '')) <> '' and quantity is null and unit_code is null
        and labour_price is null and material_price is null and vat_rate is null
      else
        btrim(coalesce(description, '')) <> '' and quantity is null and unit_code is null
        and labour_price is null and material_price is null and vat_rate is null
    end
  )
);
create index document_items_org_id_idx on werkbank.document_items (org_id);
create index document_items_quote_id_idx on werkbank.document_items (quote_id);
create index document_items_order_id_idx on werkbank.document_items (order_id);
create trigger document_items_set_updated_at before update on werkbank.document_items
  for each row execute function public.update_updated_at_column();

-- quote_acceptances (service role writes only) ----------------------------------------
create table werkbank.quote_acceptances (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid not null unique,
  decision text not null check (decision in ('accepted', 'rejected')),
  comment text,
  signer_name text not null check (btrim(signer_name) <> ''),
  method text check (method in ('typed', 'drawn')),
  typed_name text,
  signature_image_path text,
  decided_at timestamptz not null default now(),
  ip text,
  user_agent text,
  consent_text text,
  document_sha256 text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint quote_acceptances_method_required check (decision <> 'accepted' or method is not null),
  constraint quote_acceptances_quote_fk foreign key (org_id, quote_id)
    references werkbank.quotes (org_id, id) on delete cascade
);
create index quote_acceptances_org_id_idx on werkbank.quote_acceptances (org_id);
create trigger quote_acceptances_set_updated_at before update on werkbank.quote_acceptances
  for each row execute function public.update_updated_at_column();

-- Trigger functions -------------------------------------------------------------------
-- A property must belong to the document's customer. Runs as the caller: admin and producer can
-- read properties through RLS, and the service role bypasses it.
create function werkbank.check_property_customer() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.property_id is not null and not exists (
    select 1 from werkbank.properties p
    where p.id = new.property_id and p.org_id = new.org_id and p.customer_id = new.customer_id
  ) then
    raise exception 'property_customer_mismatch' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function werkbank.check_property_customer() from public, anon;

create trigger quotes_check_property_customer before insert or update of customer_id, property_id
  on werkbank.quotes for each row execute function werkbank.check_property_customer();
create trigger orders_check_property_customer before insert or update of customer_id, property_id
  on werkbank.orders for each row execute function werkbank.check_property_customer();

-- The assigned artist must belong to the order's org. SECURITY DEFINER so the check does not
-- depend on the caller's read access to public.artists; it reads nothing but that one fact.
create function werkbank.check_artist_org() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.artists a where a.id = new.artist_id and a.org_id = new.org_id
  ) then
    raise exception 'artist_org_mismatch' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function werkbank.check_artist_org() from public, anon;

create trigger order_technicians_check_artist_org before insert or update of artist_id, org_id
  on werkbank.order_technicians for each row execute function werkbank.check_artist_org();

-- RLS and grants ----------------------------------------------------------------------
alter table werkbank.company_profiles enable row level security;
alter table werkbank.quotes enable row level security;
alter table werkbank.orders enable row level security;
alter table werkbank.order_technicians enable row level security;
alter table werkbank.document_items enable row level security;
alter table werkbank.quote_acceptances enable row level security;

grant insert, update on werkbank.company_profiles to authenticated;
grant insert, update, delete on werkbank.quotes to authenticated;
grant insert, update, delete on werkbank.orders to authenticated;
grant insert, update, delete on werkbank.order_technicians to authenticated;
grant insert, update, delete on werkbank.document_items to authenticated;
-- quote_acceptances: select only (default privileges); the service role writes.

do $$
declare
  t text;
begin
  foreach t in array array['quotes', 'orders', 'order_technicians', 'document_items'] loop
    execute format($f$create policy %1$I_select on werkbank.%1$I for select to authenticated
      using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))$f$, t);
    execute format($f$create policy %1$I_insert on werkbank.%1$I for insert to authenticated
      with check (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))$f$, t);
    execute format($f$create policy %1$I_update on werkbank.%1$I for update to authenticated
      using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))
      with check (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))$f$, t);
  end loop;
end $$;

-- Delete: draft quotes, open orders, items and technician rows. The lock triggers of a later
-- migration decide what an item delete may touch.
create policy quotes_delete on werkbank.quotes for delete to authenticated
  using (status = 'draft'
    and (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer')));
create policy orders_delete on werkbank.orders for delete to authenticated
  using (status = 'open'
    and (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer')));
create policy order_technicians_delete on werkbank.order_technicians for delete to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));
create policy document_items_delete on werkbank.document_items for delete to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));

-- company_profiles: read admin and producer, write admin only.
create policy company_profiles_select on werkbank.company_profiles for select to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));
create policy company_profiles_insert on werkbank.company_profiles for insert to authenticated
  with check (public.has_org_role(auth.uid(), org_id, 'admin'));
create policy company_profiles_update on werkbank.company_profiles for update to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin'))
  with check (public.has_org_role(auth.uid(), org_id, 'admin'));

-- quote_acceptances: read admin and producer; no write policy.
create policy quote_acceptances_select on werkbank.quote_acceptances for select to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));
