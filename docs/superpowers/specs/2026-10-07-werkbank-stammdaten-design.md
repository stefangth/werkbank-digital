# Werkbank Teil 2: Master data (customers, properties, contacts, service catalog). Spec

**Date:** 2026-10-07
**Status:** Draft, awaiting owner review.
**Decision records:** [ADR-0014](../../adr/0014-werkbank-as-separate-fork.md) (Werkbank is a separate fork; the ADR-0013 isolation rules still hold), [ADR-0013](../../adr/0013-werkbank-as-removable-module.md) (isolation model, roadmap of Teil 0 to 6).
**Builds on:** `2026-10-06-werkbank-fundament-design.md` (Teil 1: org kind `handwerk`, brand, kind-aware surface, technicians page, empty `werkbank` schema, guards).

---

## Problem

After Teil 1 a `handwerk` org can sign in, sees the Werkbank brand and can create
technicians, and nothing else. Before the pilot business can write a quote (Teil 3) or an
invoice (Teil 4), it needs its master data in Werkbank: the property management companies
and private customers it works for, the properties it works at, the people to call there,
and the services it sells with their prices.

The master data must carry everything the later parts need without a rework, above all the
buyer data of an EN 16931 e-invoice (Teil 4): the invoice recipient (often a WEG
represented by the property manager), its address, invoice email, VAT ID and unit codes of
the invoiced services, plus the labour share of a price, which private customers and WEG
owners need for the tax reduction under §35a EStG.

**Success:** the pilot business enters or imports its real customer base, finds any
property with its on-site contact in seconds, and maintains a service catalog it can quote
from in Teil 3.

## Decision summary (locked with the owner, 2026-10-07)

| Question | Decision |
|---|---|
| Customer types | Property managers (Hausverwaltungen) **and** private customers in V1 |
| Invoice recipient | The customer by default; a property can name a different recipient (for example "WEG Musterstr. 5"), addressed in Teil 4 as represented by the property manager |
| Getting data in | Manual entry **and** CSV/Excel import for customers, properties and catalog items |
| Catalog price | Split into labour and material share (§35a EStG); net price is their sum |
| Contacts | On the customer (property manager staff) and on the property (caretaker, advisory board, tenant) |
| Data model | Approach A: one table per concept in schema `werkbank`, addresses as columns (not a generic party model, not jsonb) |
| Core touch points | Werkbank registers directly in the existing help items, page minis, settings tabs and org export. No new generic extension points (ADR-0014: there is no second module). The touched core files join the allow-list of `scripts/moduleIsolation.test.ts` by name |
| Numbering | New `werkbank.number_ranges` with a row-locking `werkbank.next_number`; Teil 2 uses it for customer numbers, Teil 3 and 4 reuse it |
| Search | Client-side filtering, as on the artists page |
| Changelog | Werkbank gets its own changelog; the Showflow history is removed from it |

## Non-goals

- Quotes, orders, invoices, open items (Teil 3 to 5), and anything that references master data from them.
- Technician access to master data (Teil 6). Technicians see none of the new pages or rows.
- Units inside a property (apartments). The order in Teil 3 gets a free-text location field instead.
- Customer bank details and SEPA mandates (no direct debit in V1).
- Contact import, duplicate detection beyond the customer number, merging customers.
- Server-side or fuzzy search (`pg_trgm`, `tsvector`).
- Removing the inherited Showflow domain (separate spec per ADR-0014).

## Requirements

### R1. Tables (schema `werkbank`)

Every table: `id uuid primary key default gen_random_uuid()`, `org_id uuid not null
references public.organizations(id) on delete cascade`, `created_at` and `updated_at
timestamptz not null default now()`, an `updated_at` trigger using
`public.update_updated_at_column()`, RLS enabled (R3). Each parent table also declares
`unique (org_id, id)` so children reference it through a composite foreign key
`(org_id, parent_id)`. A child row can therefore never point at another org's parent.

**`werkbank.customers`**

| Column | Type and rule |
|---|---|
| `customer_no` | `text not null`, `unique (org_id, customer_no)`. Assigned by a `before insert` trigger from `next_number(org_id, 'customer')` when null (R2); the import may supply a legacy number |
| `kind` | `text not null check (kind in ('property_manager', 'private'))` |
| `company_name` | `text`; required when `kind = 'property_manager'` |
| `first_name`, `last_name` | `text`; `last_name` required when `kind = 'private'` |
| `street`, `postal_code`, `city` | `text not null` (non-blank) |
| `country_code` | `text not null default 'DE' check (country_code ~ '^[A-Z]{2}$')`; when `'DE'`, `postal_code ~ '^[0-9]{5}$'` |
| `email`, `invoice_email`, `phone` | `text`, optional; emails checked with `~ '^[^@\s]+@[^@\s]+$'` |
| `vat_id` | `text`, optional, `~ '^[A-Z]{2}[0-9A-Za-z+*.]{2,12}$'` |
| `payment_terms_days` | `integer not null default 14 check (between 0 and 365)` |
| `notes` | `text` |
| `archived_at` | `timestamptz`; null means active |

**`werkbank.properties`**

| Column | Type and rule |
|---|---|
| `customer_id` | `uuid not null`, FK `(org_id, customer_id)` to customers, `on delete restrict` |
| `name` | `text not null` (for example "WEG Musterstr. 5") |
| `object_no` | `text`, the property manager's object number, optional |
| `street`, `postal_code`, `city`, `country_code` | as on customers |
| `billing_name` | `text`; null means the invoice goes to the customer |
| `billing_street`, `billing_postal_code`, `billing_city`, `billing_country_code` | required together when `billing_name` is set, same format rules; all null otherwise |
| `access_notes`, `notes` | `text` |
| `archived_at` | `timestamptz` |

Private customers need no property; Teil 3 falls back to the customer address as the job location.

**`werkbank.contacts`**

| Column | Type and rule |
|---|---|
| `customer_id`, `property_id` | `uuid`, `check (num_nonnulls(customer_id, property_id) = 1)`; composite FKs to customers and properties, `on delete cascade` |
| `first_name` | `text` |
| `last_name` | `text not null` |
| `role` | `text`, free text (Sachbearbeiterin, Hausmeister, Beirat, Mieter) |
| `phone`, `mobile`, `email`, `notes` | `text`, optional, email format as above |
| `is_primary` | `boolean not null default false`; partial unique indexes allow at most one primary per customer and per property |

Contacts are hard-deleted, not archived, so tenant data can be removed on request.

**`werkbank.catalog_items`**

| Column | Type and rule |
|---|---|
| `item_no` | `text`, optional, unique per org when set (partial unique index) |
| `name` | `text not null` |
| `description`, `category` | `text`, optional |
| `unit_code` | `text not null check (unit_code in ('HUR','H87','MTR','MTK','MTQ','KGM','LTR','LS'))`, UN/ECE Rec 20, as EN 16931 requires |
| `labour_price`, `material_price` | `numeric(12,2) not null default 0 check (>= 0)` |
| `net_price` | `numeric(12,2) generated always as (labour_price + material_price) stored` |
| `vat_rate` | `numeric(4,2) not null default 19 check (vat_rate in (19, 7, 0))` |
| `archived_at` | `timestamptz` |

Unit labels (DE / EN): `HUR` Std / h, `H87` Stk / pc, `MTR` m, `MTK` m², `MTQ` m³, `KGM` kg,
`LTR` l, `LS` pauschal / lump sum. Quotes and invoices (Teil 3, 4) copy name, unit, prices and
VAT rate as a snapshot, so a catalog change never alters an existing document.

Indexes: `(org_id)` on every table, `(org_id, customer_id)` on properties, `(customer_id)`
and `(property_id)` on contacts, partial `(org_id) where archived_at is null` on the three
archivable tables.

### R2. Number ranges

- `werkbank.number_ranges (org_id, key text, prefix text not null default '', next_value bigint not null check (next_value > 0), padding int not null default 0 check (between 0 and 10), primary key (org_id, key))`, RLS enabled.
- `werkbank.next_number(p_org uuid, p_key text) returns text`: `security definer`, `set search_path = ''`. It locks the row with `select ... for update`, formats `prefix || lpad(next_value::text, padding, '0')` and increments `next_value` in the same transaction, so a rolled-back insert does not consume a number. A missing row is created with the defaults of the key. Execute is revoked from `public`, `anon` and `authenticated` (Werkbank function rule); it is called only from the customer-number trigger function and the import RPCs, which are themselves `security definer` and owned by the migrating role, so callers need no execute right on it.
- Default for key `customer`: prefix `K-`, `next_value` 10001, padding 0, giving `K-10001`. The row is created with these defaults on first use (no provisioning change needed).
- A manually or import-supplied `customer_no` does not consume a number. After an import, the import RPC raises `next_value` above the highest imported number that matches `prefix` followed by digits, so the next generated number cannot collide.
- Admins edit `prefix` and `next_value` in the settings tab "Nummernkreise" (R6). Lowering `next_value` below an existing number is allowed; the unique constraint then reports a collision on insert (R8). Customer numbers may have gaps; the gap-free guarantee in Teil 4 is for invoice numbers and is specified there.

### R3. Access (RLS and grants)

- Read: `has_org_role(auth.uid(), org_id, 'admin') or has_org_role(auth.uid(), org_id, 'producer')`, on all five tables.
- Insert and update: same predicate on customers, properties, contacts and catalog_items. `number_ranges`: admins only.
- Delete: admins only on customers, properties and catalog_items; admin and producer on contacts.
- Technicians (`artist`) and members of other orgs get nothing.
- Grants: the tables are SELECT-only for `authenticated` by default (Teil 1 default privileges); each migration grants exactly the insert, update and delete matching its policies.
- Hard delete fails with a foreign key violation while something references the row (properties on a customer now; quotes and orders from Teil 3). The UI offers archiving instead (R8).
- Archived rows stay readable and editable; archiving is a list filter, not a lock.

### R4. Data and hooks layer

- `src/features/werkbank/data/{customers,properties,contacts,catalog,numberRanges}.ts`: pure async functions taking the client and `orgId`, using `client.schema('werkbank')`, throwing on error, in the style of `data/technicians.ts`.
- List reads page through in batches of 1000 rows (the PostgREST row limit) until a short batch, so lists stay complete after a large import.
- `src/features/werkbank/hooks/`: React Query hooks with keys `["werkbank", <entity>, orgId, ...]`. Mutations show a sonner toast in the `werkbank` namespace and invalidate `["werkbank", <entity>]` (and the parent entity where counts change).
- Generated types include the new tables via `--schema public,graphql_public,werkbank`; the edge mirror is refreshed with `npm run sync:mirrors`.

### R5. Pages and navigation

New nav items in `src/features/werkbank/ui.ts`, section `workspace`, `kinds: ["handwerk"]`, roles admin and producer, in this order: Kunden (`/customers`), Liegenschaften (`/properties`), Leistungen (`/catalog`), Monteure (`/technicians`, existing). Paths live in `paths.ts`; pages load lazily. Each page follows CLAUDE.md: `PageHeader`, `Skeleton` while loading, `Alert variant="destructive"` on a page error, `EmptyState` with an action or a reason.

**Customers list (`/customers`).** Columns: Nr., Name (company name, or "Nachname, Vorname"), Art (`StatusPill`: HV or Privat), Ort, Liegenschaften (count), Telefon. One search field over name, number, city and email (debounced). Filter Art (Alle, Hausverwaltung, Privat). Switch "Archivierte zeigen". Header actions "Kunde anlegen" and "Importieren".

**Customer detail (`/customers/:id`).** Header: name, number, kind; actions Bearbeiten, Archivieren or Wiederherstellen, Löschen (admin only). Sections:
- Stammdaten: address, email, invoice email, phone, VAT ID, payment terms, notes.
- Liegenschaften: list with "Liegenschaft anlegen" (customer preselected).
- Ansprechpartner: list with create, edit and delete in a dialog; the primary contact is marked.

**Properties list (`/properties`).** Columns: Name, Objekt-Nr., Adresse, Kunde. The search covers name, object number, street, postal code, city and customer name. Same archive switch.

**Property detail (`/properties/:id`).** Address; a box "Rechnung geht an" showing either the customer's name and address or the billing recipient with "vertreten durch <customer>"; access notes; notes; on-site contacts with the same dialog as on the customer.

**Catalog (`/catalog`).** Columns: Nr., Name, Kategorie, Einheit, Lohn, Material, Netto, MwSt. Search over number, name and description; filter Kategorie (distinct values); archive switch. Header actions "Leistung anlegen" and "Importieren". Amounts use `formatMoney` with the UI language.

**Forms.** Dialogs with react-hook-form and zod, like `AddTechnicianDialog`, used for both create and edit.
- Customer: a kind toggle first; it shows company name or first and last name. Country is a select defaulting to Deutschland.
- Property: customer picker (searchable, active customers only), a checkbox "Abweichender Rechnungsempfänger" that reveals the billing fields.
- Catalog item: unit select with the German labels, VAT select, labour and material inputs with a live net total.
- Contact: name, role, phone, mobile, email, notes, "Hauptansprechpartner".
- The zod schemas mirror the database checks of R1 and live in `src/features/werkbank/schemas/`.

### R6. Settings tab "Nummernkreise"

- New `?tab=numbering` tab, admins only, offered to `handwerk` only (`SETTINGS_TAB_KINDS`). Shows prefix, next number and a live preview of the next customer number; saves through `data/numberRanges.ts`.
- Teil 3 and 4 add their keys to the same tab.

### R7. CSV and Excel import

- One import dialog per entity: customers, properties, catalog items. Steps: upload (CSV or XLSX, reusing `parseSheet` and `MAX_IMPORT_ROWS` = 5000 from `src/lib/artistImport/`), map columns (suggested via `guessMapping` with German and English header aliases), review (per-row validation with the zod schemas of R5, invalid rows listed with the reason and excluded), import, summary.
- Server: `werkbank.import_customers(p_org uuid, p_rows jsonb)`, `werkbank.import_properties(...)` and `werkbank.import_catalog_items(...)`, `security definer`, `set search_path = ''`. Each checks that the caller is admin or producer of `p_org`, processes every row in its own savepoint, and returns `jsonb` with one `{ row, status: 'created' | 'skipped' | 'error', reason }` per input row, like `bulk_import_artists`. Execute is granted to `authenticated` only.
- Customers: an existing `customer_no` skips the row ("Kundennummer schon vergeben"); rows without a number get one from the range; afterwards the range is raised (R2).
- Properties reference their customer by `customer_no`; an unknown number is an error row. The dialog says to import customers first.
- Catalog items: an existing `item_no` skips the row.
- Nothing is updated or overwritten by an import.

### R8. Errors

- Database errors map to `werkbank` copy in one helper (`src/features/werkbank/lib/dbErrors.ts`):
  - `23505` on the customer number: "Diese Kundennummer ist schon vergeben."
  - `23505` on the item number: "Diese Artikelnummer ist schon vergeben."
  - `23503` on delete: "Das wird noch verwendet. Archiviere es stattdessen."
  - RLS or permission errors: "Dafür fehlen dir die Rechte."
  - Anything else: a generic retry message.
- Concurrent edits: last write wins. Only number assignment is serialised (R2).
- The delete confirmation (`AlertDialog`) names what is deleted; a customer delete also deletes its contacts and is refused while properties exist.

### R9. Dashboard

The `handwerk` dashboard placeholder becomes a start list for admin and producer with three steps, each with a count and a link: "Monteure anlegen", "Leistungen anlegen oder importieren", "Kunden anlegen oder importieren". A step shows as done when at least one row exists. Technicians keep the welcome text.

### R10. Help, page minis and changelog

- Help: Werkbank help items for customers, properties, contacts, catalog (including §35a and units), import and number ranges, in `src/lib/help/items.ts` (EN and DE, "Du", no dashes). The Help nav item and help center are offered to `handwerk` again, showing only items flagged for that kind; Showflow items stay hidden for it.
- Page minis for `/customers`, `/properties` and `/catalog` (`src/lib/minis/pages/`, illustrations, `MINIS` registry). The detail pages get "No mini." (they extend their list page).
- Changelog: `public/changelog.md` is replaced by a Werkbank changelog whose first entry announces Teil 2; `public/changelog.json` is regenerated with `scripts/changelog-to-json.ts`.
- The core files touched here (`src/lib/help/items.ts`, `src/lib/minis/index.ts`, `src/lib/settingsTabs.ts`, the SettingsPage tab list, `supabase/functions/export-org-data/index.ts`, and any minis or help component that must name the kind) are added by name to the `werkbank` allow-list in `scripts/moduleIsolation.test.ts`.

### R11. Org data export

`export-org-data` exports the five Werkbank tables next to `ORG_TABLES`, read through `.schema('werkbank')` and filtered by `org_id`, under a `werkbank` key in the export. This also gives the business its data (ADR-0013 removal step 1).

## Testing

Test-first per CLAUDE.md; tests import real modules.

- **pgTAP (`supabase/tests/werkbank/`):**
  - RLS per role and table: admin and producer read and write; producer cannot delete customers, properties or catalog items; technician and other-org admin see and change nothing; only admins write `number_ranges`.
  - Every check constraint of R1, the composite foreign keys (no cross-org parent), the primary-contact uniqueness, `on delete restrict` and the cascade from organizations.
  - `next_number`: sequential values, formatting, rollback does not consume a number, default row creation, not executable by `authenticated`.
  - Import RPCs: statuses per row, skipped duplicates, unknown customer number, range raised after import, rejected for technicians and other orgs.
  - The existing isolation test passes (RLS on every table, function grants).
- **Vitest:** zod schemas (parity with the database checks), net price, unit labels, `dbErrors`, import mapping aliases and row building, data-layer paging, the list pages (search, filters, archive switch, empty states, role gating), detail pages, settings tab gating, dashboard start list, `moduleIsolation.test.ts` with the new allow-list entries.
- **Deno:** `export-org-data` includes the Werkbank tables for the org and nothing from other orgs.
- **Playwright (`e2e/werkbank-stammdaten.spec.ts`):** an admin creates a property manager, a property with a billing recipient, a contact and a catalog item, then imports a customer CSV and sees the imported rows.

## Delivery

Five PRs, each green on its own:

1. **Database:** R1 to R3, types, R11. No UI.
2. **Catalog:** R4 and R5 for the catalog, R6, R8 helper.
3. **Customers, properties, contacts:** R4 and R5 for them.
4. **Import:** R7.
5. **Start list, help, minis, changelog:** R9, R10.

## Go-live checklist additions

1. Apply the Teil 2 migrations to the production project `wmtbjajmnjxefrhkchts` before deploying the frontend.
2. Confirm `werkbank` is listed under "Exposed schemas" in that project (ADR-0014); without it every page of Teil 2 fails with 404.

## Risks

- **PostgREST row limit.** Lists read all rows; without the paging of R4 a large import would silently truncate lists at 1000 rows. Covered by a data-layer test.
- **Client-side search at scale.** Fine for hundreds to a few thousand rows; beyond that a server-side search is a follow-up.
- **Legacy numbers in other formats.** Imported numbers that do not match the configured prefix are kept but do not raise the range; the admin may need to set the next number by hand. The import summary says so.
- **Billing recipient correctness for e-invoices.** Teil 2 only stores the recipient; the exact EN 16931 mapping (buyer versus invoicee, "vertreten durch") is specified and validated with Mustang in Teil 4.
