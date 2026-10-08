-- Werkbank Teil 5: open items and dunning tables, dunning settings columns.
-- Spec: docs/superpowers/specs/2026-10-08-werkbank-offene-posten-design.md (R1).
-- The three tables are select-only for authenticated; writes come through the RPCs of a later
-- migration, which also adds the lock triggers, views and storage rules.

-- company_profiles --------------------------------------------------------------------
alter table werkbank.company_profiles
  add column reminder_after_days integer not null default 7
    constraint company_profiles_reminder_after_days_range check (reminder_after_days between 0 and 365),
  add column dunning1_after_days integer not null default 14
    constraint company_profiles_dunning1_after_days_range check (dunning1_after_days between 0 and 365),
  add column dunning2_after_days integer not null default 14
    constraint company_profiles_dunning2_after_days_range check (dunning2_after_days between 0 and 365),
  add column dunning_deadline_days integer not null default 7
    constraint company_profiles_dunning_deadline_days_range check (dunning_deadline_days between 0 and 365),
  add column reminder_text text,
  add column dunning1_text text,
  add column dunning2_text text;

-- invoice_entries -----------------------------------------------------------------------
create table werkbank.invoice_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null,
  kind text not null check (kind in ('payment', 'refund', 'write_off')),
  amount numeric(12,2) not null check (amount > 0),
  booked_on date not null,
  write_off_reason text check (write_off_reason in ('skonto', 'goodwill', 'bad_debt', 'other')),
  note text,
  transferred_from uuid,
  reversed_at timestamptz,
  reversed_by uuid,
  reversal_reason text check (reversal_reason is null or btrim(reversal_reason) <> ''),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint invoice_entries_org_id_id_key unique (org_id, id),
  constraint invoice_entries_transferred_from_key unique (transferred_from),
  constraint invoice_entries_invoice_fk foreign key (org_id, invoice_id)
    references werkbank.invoices (org_id, id) on delete no action,
  constraint invoice_entries_transferred_from_fk foreign key (org_id, transferred_from)
    references werkbank.invoice_entries (org_id, id) on delete no action,
  constraint invoice_entries_write_off_reason check ((kind = 'write_off') = (write_off_reason is not null)),
  constraint invoice_entries_other_needs_note
    check (write_off_reason is distinct from 'other' or (note is not null and btrim(note) <> '')),
  constraint invoice_entries_one_reversal
    check ((reversed_at is null) = (reversed_by is null) and (reversed_at is null) = (reversal_reason is null))
);
create index invoice_entries_org_id_idx on werkbank.invoice_entries (org_id);
create index invoice_entries_invoice_id_idx on werkbank.invoice_entries (invoice_id);

-- dunning_notices -----------------------------------------------------------------------
create table werkbank.dunning_notices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  invoice_id uuid not null,
  stage smallint not null check (stage between 1 and 3),
  notice_date date not null,
  payment_deadline date not null,
  invoice_gross numeric(12,2) not null,
  paid_amount numeric(12,2) not null,
  open_amount numeric(12,2) not null check (open_amount > 0),
  delivery text not null check (delivery in ('email', 'print')),
  pdf_path text,
  pdf_sha256 text,
  sent_at timestamptz,
  sent_to text[],
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint dunning_notices_org_id_id_key unique (org_id, id),
  constraint dunning_notices_stage_unique unique (invoice_id, stage),
  constraint dunning_notices_invoice_fk foreign key (org_id, invoice_id)
    references werkbank.invoices (org_id, id) on delete no action,
  constraint dunning_notices_deadline_check check (payment_deadline >= notice_date)
);
create index dunning_notices_org_id_idx on werkbank.dunning_notices (org_id);

-- dunning_holds -------------------------------------------------------------------------
create table werkbank.dunning_holds (
  invoice_id uuid primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  reason text not null check (btrim(reason) <> ''),
  until date,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint dunning_holds_org_id_id_key unique (org_id, invoice_id),
  constraint dunning_holds_invoice_fk foreign key (org_id, invoice_id)
    references werkbank.invoices (org_id, id) on delete cascade
);
create index dunning_holds_org_id_idx on werkbank.dunning_holds (org_id);

-- RLS and grants (select only; writes go through SECURITY DEFINER RPCs) --------------------
alter table werkbank.invoice_entries enable row level security;
alter table werkbank.dunning_notices enable row level security;
alter table werkbank.dunning_holds enable row level security;

create policy invoice_entries_select on werkbank.invoice_entries for select to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));
create policy dunning_notices_select on werkbank.dunning_notices for select to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));
create policy dunning_holds_select on werkbank.dunning_holds for select to authenticated
  using (public.has_org_role(auth.uid(), org_id, 'admin') or public.has_org_role(auth.uid(), org_id, 'producer'));
