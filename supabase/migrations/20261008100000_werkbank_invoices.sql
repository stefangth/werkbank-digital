-- Werkbank Teil 4: invoices table and column additions.
-- Spec: docs/superpowers/specs/2026-10-08-werkbank-rechnung-design.md (R1).
-- The lock trigger, number assignment, RPCs, views and storage rules follow in later migrations.

-- company_profiles --------------------------------------------------------------------
alter table werkbank.company_profiles
  add column invoice_intro text,
  add column invoice_closing text,
  add column payment_due_days integer not null default 14
    constraint company_profiles_payment_due_days_range check (payment_due_days between 0 and 365);

-- orders: the status check gains 'invoiced' ---------------------------------------------
alter table werkbank.orders drop constraint orders_status_check;
alter table werkbank.orders add constraint orders_status_check
  check (status in ('open', 'in_progress', 'done', 'invoiced', 'cancelled'));

-- invoices ----------------------------------------------------------------------------
create table werkbank.invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type text not null default 'invoice' check (type in ('invoice', 'cancellation')),
  invoice_no text,
  order_id uuid,
  cancels_invoice_id uuid,
  customer_id uuid not null,
  property_id uuid,
  contact_id uuid,
  location_note text,
  subject text,
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  intro_text text,
  closing_text text,
  payment_terms_text text,
  service_date_from date,
  service_date_to date,
  payment_due_days integer not null default 14
    constraint invoices_payment_due_days_range check (payment_due_days between 0 and 365),
  issue_date date,
  due_date date,
  status text not null default 'draft' check (status in ('draft', 'issued', 'cancelled')),
  issued_at timestamptz,
  seller_snapshot jsonb,
  buyer_snapshot jsonb,
  pdf_path text,
  pdf_sha256 text,
  sent_at timestamptz,
  sent_to text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoices_org_id_id_key unique (org_id, id),
  constraint invoices_invoice_no_key unique (org_id, invoice_no),
  constraint invoices_cancels_invoice_id_key unique (cancels_invoice_id),
  constraint invoices_order_fk foreign key (org_id, order_id)
    references werkbank.orders (org_id, id) on delete no action,
  constraint invoices_cancels_fk foreign key (org_id, cancels_invoice_id)
    references werkbank.invoices (org_id, id) on delete no action,
  constraint invoices_customer_fk foreign key (org_id, customer_id)
    references werkbank.customers (org_id, id) on delete no action,
  constraint invoices_property_fk foreign key (org_id, property_id)
    references werkbank.properties (org_id, id) on delete no action,
  constraint invoices_contact_fk foreign key (org_id, contact_id)
    references werkbank.contacts (org_id, id) on delete set null (contact_id),
  constraint invoices_number_after_draft check (status = 'draft' or invoice_no is not null),
  constraint invoices_cancellation_link check ((type = 'cancellation') = (cancels_invoice_id is not null)),
  constraint invoices_cancelled_only_invoice check (status <> 'cancelled' or type = 'invoice'),
  constraint invoices_service_dates check (
    service_date_to is null
    or (service_date_from is not null and service_date_to >= service_date_from)),
  constraint invoices_snapshots_after_draft check (
    status = 'draft' or (seller_snapshot is not null and buyer_snapshot is not null))
);
-- At most one active invoice per order, drafts included.
create unique index invoices_one_active_per_order on werkbank.invoices (org_id, order_id)
  where type = 'invoice' and status <> 'cancelled';
create index invoices_org_id_idx on werkbank.invoices (org_id);
create index invoices_org_customer_idx on werkbank.invoices (org_id, customer_id);
create index invoices_org_status_idx on werkbank.invoices (org_id, status);
create index invoices_order_id_idx on werkbank.invoices (order_id);
create index invoices_property_id_idx on werkbank.invoices (property_id);
create index invoices_contact_id_idx on werkbank.invoices (contact_id);
create trigger invoices_set_updated_at before update on werkbank.invoices
  for each row execute function public.update_updated_at_column();
create trigger invoices_check_property_customer before insert or update of customer_id, property_id
  on werkbank.invoices for each row execute function werkbank.check_property_customer();

-- document_items: invoices as a third parent ----------------------------------------------
alter table werkbank.document_items add column invoice_id uuid;
alter table werkbank.document_items drop constraint document_items_one_parent;
alter table werkbank.document_items add constraint document_items_one_parent
  check (num_nonnulls(quote_id, order_id, invoice_id) = 1);
alter table werkbank.document_items add constraint document_items_invoice_fk
  foreign key (org_id, invoice_id) references werkbank.invoices (org_id, id) on delete cascade;
create index document_items_invoice_id_idx on werkbank.document_items (invoice_id);

-- Item edits also touch their draft invoice (same reasoning as touch_draft_quote).
create or replace function werkbank.touch_draft_quote()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_quote uuid := case when tg_op = 'DELETE' then old.quote_id else new.quote_id end;
  v_invoice uuid := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
begin
  if v_quote is not null then
    update werkbank.quotes q set updated_at = now()
    where q.id = v_quote and q.status = 'draft' and q.updated_at is distinct from now();
  end if;
  if v_invoice is not null then
    update werkbank.invoices i set updated_at = now()
    where i.id = v_invoice and i.status = 'draft' and i.updated_at is distinct from now();
  end if;
  return null;
end;
$$;

-- RLS and grants ----------------------------------------------------------------------
alter table werkbank.invoices enable row level security;
grant insert, update, delete on werkbank.invoices to authenticated;

create policy invoices_select on werkbank.invoices for select to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));
create policy invoices_insert on werkbank.invoices for insert to authenticated
  with check (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));
create policy invoices_update on werkbank.invoices for update to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'))
  with check (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));
-- Only drafts are deletable; the lock trigger of a later migration enforces the rest.
create policy invoices_delete on werkbank.invoices for delete to authenticated
  using (status = 'draft'
    and (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer')));
