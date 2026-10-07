-- Werkbank Teil 2: master data (customers, properties, contacts, catalog_items).
-- Spec: docs/superpowers/specs/2026-10-07-werkbank-stammdaten-design.md (R1, R3).
-- Children reference parents through composite FKs (org_id, parent_id), so a child row can
-- never point at another org's parent. Access: admin and producer read and write; delete is
-- admin only, except contacts (admin and producer). Everything else (artist, other orgs) gets nothing.

-- customers ---------------------------------------------------------------------------
create table werkbank.customers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_no text not null,
  kind text not null check (kind in ('property_manager', 'private')),
  company_name text,
  first_name text,
  last_name text,
  street text not null check (btrim(street) <> ''),
  postal_code text not null check (btrim(postal_code) <> ''),
  city text not null check (btrim(city) <> ''),
  country_code text not null default 'DE' check (country_code ~ '^[A-Z]{2}$'),
  email text check (email ~ '^[^@\s]+@[^@\s]+$'),
  invoice_email text check (invoice_email ~ '^[^@\s]+@[^@\s]+$'),
  phone text,
  vat_id text check (vat_id ~ '^[A-Z]{2}[0-9A-Za-z+*.]{2,12}$'),
  payment_terms_days integer not null default 14 check (payment_terms_days between 0 and 365),
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_org_id_id_key unique (org_id, id),
  constraint customers_customer_no_unique unique (org_id, customer_no),
  constraint customers_company_name_required
    check (kind <> 'property_manager' or btrim(coalesce(company_name, '')) <> ''),
  constraint customers_last_name_required
    check (kind <> 'private' or btrim(coalesce(last_name, '')) <> ''),
  constraint customers_de_postal_code
    check (country_code <> 'DE' or postal_code ~ '^[0-9]{5}$')
);
create index customers_org_id_idx on werkbank.customers (org_id);
create index customers_org_active_idx on werkbank.customers (org_id) where archived_at is null;
create trigger customers_set_updated_at before update on werkbank.customers
  for each row execute function public.update_updated_at_column();

-- properties --------------------------------------------------------------------------
-- on delete no action (not restrict): the check runs at statement end, so deleting a customer
-- that still has properties fails with 23503, while the org-delete cascade can remove both.
create table werkbank.properties (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid not null,
  name text not null check (btrim(name) <> ''),
  object_no text,
  street text not null check (btrim(street) <> ''),
  postal_code text not null check (btrim(postal_code) <> ''),
  city text not null check (btrim(city) <> ''),
  country_code text not null default 'DE' check (country_code ~ '^[A-Z]{2}$'),
  billing_name text,
  billing_street text,
  billing_postal_code text,
  billing_city text,
  billing_country_code text check (billing_country_code ~ '^[A-Z]{2}$'),
  access_notes text,
  notes text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_org_id_id_key unique (org_id, id),
  constraint properties_customer_fk foreign key (org_id, customer_id)
    references werkbank.customers (org_id, id) on delete no action,
  constraint properties_de_postal_code
    check (country_code <> 'DE' or postal_code ~ '^[0-9]{5}$'),
  constraint properties_billing_de_postal_code
    check (billing_country_code <> 'DE' or billing_postal_code ~ '^[0-9]{5}$'),
  constraint properties_billing_group check (
    (billing_name is null and billing_street is null and billing_postal_code is null
      and billing_city is null and billing_country_code is null)
    or (btrim(coalesce(billing_name, '')) <> '' and btrim(coalesce(billing_street, '')) <> ''
      and btrim(coalesce(billing_postal_code, '')) <> '' and btrim(coalesce(billing_city, '')) <> ''
      and btrim(coalesce(billing_country_code, '')) <> '')
  )
);
create index properties_org_id_idx on werkbank.properties (org_id);
create index properties_org_customer_idx on werkbank.properties (org_id, customer_id);
create index properties_org_active_idx on werkbank.properties (org_id) where archived_at is null;
create trigger properties_set_updated_at before update on werkbank.properties
  for each row execute function public.update_updated_at_column();

-- contacts ----------------------------------------------------------------------------
create table werkbank.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  customer_id uuid,
  property_id uuid,
  first_name text,
  last_name text not null check (btrim(last_name) <> ''),
  role text,
  phone text,
  mobile text,
  email text check (email ~ '^[^@\s]+@[^@\s]+$'),
  notes text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contacts_one_parent check (num_nonnulls(customer_id, property_id) = 1),
  constraint contacts_customer_fk foreign key (org_id, customer_id)
    references werkbank.customers (org_id, id) on delete cascade,
  constraint contacts_property_fk foreign key (org_id, property_id)
    references werkbank.properties (org_id, id) on delete cascade
);
create index contacts_org_id_idx on werkbank.contacts (org_id);
create index contacts_customer_id_idx on werkbank.contacts (customer_id);
create index contacts_property_id_idx on werkbank.contacts (property_id);
create unique index contacts_primary_per_customer on werkbank.contacts (customer_id)
  where is_primary and customer_id is not null;
create unique index contacts_primary_per_property on werkbank.contacts (property_id)
  where is_primary and property_id is not null;
create trigger contacts_set_updated_at before update on werkbank.contacts
  for each row execute function public.update_updated_at_column();

-- catalog_items -----------------------------------------------------------------------
create table werkbank.catalog_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  item_no text,
  name text not null check (btrim(name) <> ''),
  description text,
  category text,
  unit_code text not null check (unit_code in ('HUR', 'H87', 'MTR', 'MTK', 'MTQ', 'KGM', 'LTR', 'LS')),
  labour_price numeric(12,2) not null default 0 check (labour_price >= 0),
  material_price numeric(12,2) not null default 0 check (material_price >= 0),
  net_price numeric(12,2) generated always as (labour_price + material_price) stored,
  vat_rate numeric(4,2) not null default 19 check (vat_rate in (19, 7, 0)),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index catalog_items_org_id_idx on werkbank.catalog_items (org_id);
create index catalog_items_org_active_idx on werkbank.catalog_items (org_id) where archived_at is null;
create unique index catalog_items_item_no_unique on werkbank.catalog_items (org_id, item_no)
  where item_no is not null;
create trigger catalog_items_set_updated_at before update on werkbank.catalog_items
  for each row execute function public.update_updated_at_column();

-- RLS and grants ----------------------------------------------------------------------
alter table werkbank.customers enable row level security;
alter table werkbank.properties enable row level security;
alter table werkbank.contacts enable row level security;
alter table werkbank.catalog_items enable row level security;

grant insert, update, delete on werkbank.customers to authenticated;
grant insert, update, delete on werkbank.properties to authenticated;
grant insert, update, delete on werkbank.contacts to authenticated;
grant insert, update, delete on werkbank.catalog_items to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['customers', 'properties', 'contacts', 'catalog_items'] loop
    execute format($f$create policy %1$I_select on werkbank.%1$I for select to authenticated
      using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))$f$, t);
    execute format($f$create policy %1$I_insert on werkbank.%1$I for insert to authenticated
      with check (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))$f$, t);
    execute format($f$create policy %1$I_update on werkbank.%1$I for update to authenticated
      using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))
      with check (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))$f$, t);
  end loop;
end $$;

create policy customers_delete on werkbank.customers for delete to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin'));
create policy properties_delete on werkbank.properties for delete to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin'));
create policy catalog_items_delete on werkbank.catalog_items for delete to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin'));
create policy contacts_delete on werkbank.contacts for delete to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));
