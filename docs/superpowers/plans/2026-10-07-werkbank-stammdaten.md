# Werkbank Teil 2: Master Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Office staff of a `handwerk` org maintain customers (property managers and private), properties with an optional different invoice recipient, contacts and a service catalog with labour and material share. They can enter the data by hand or import it from CSV/Excel, and the data is ready for quotes and e-invoices in Teil 3 and 4.

**Architecture:** Five tables plus a number-range table live in the Postgres schema `werkbank`. They are protected by RLS on `has_org_role`, and import RPCs run as `security definer` with one savepoint per row. The frontend lives entirely in `src/features/werkbank/`:
- data functions on `client.schema('werkbank')` with paging past the 1000-row PostgREST limit
- React Query hooks
- list and detail pages with react-hook-form plus zod dialogs
- a generic import dialog that the three importers parametrise

Core files are touched only where the spec names them (help, minis, settings tab, org export, changelog). Each of those is added by name to the isolation allow-lists.

**Tech Stack:** React 18, Vite, TypeScript, react-i18next, TanStack Query, react-hook-form, zod, papaparse/SheetJS (via `parseSheet`), Supabase (Postgres, pgTAP, Deno edge functions), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-werkbank-stammdaten-design.md` (with ADR-0014 and ADR-0013). Read the spec before starting; requirement ids (R1 to R11) below refer to it.

## Global Constraints

- Werkbank code lives in `src/features/werkbank/**`, migrations `supabase/migrations/*_werkbank_*.sql`, pgTAP in `supabase/tests/werkbank/`, e2e in `e2e/werkbank-*.spec.ts`. Werkbank code must not import booking, show, show-date, cast, hire-order or Airtable modules (ESLint enforces it).
- Werkbank tables are read only with `client.schema("werkbank")`. Every table enables RLS and grants `insert`, `update` and `delete` explicitly; every function runs `revoke all on function ... from public, anon` and grants execute explicitly (`supabase/tests/werkbank/isolation.test.sql` enforces both).
- Every FK to `public.organizations` is `on delete cascade`.
- Behaviour of `production` and `staffing` orgs must not change; existing tests pass unchanged unless a task says otherwise.
- Test-first. Tests import real modules. Frontend data tests use `createFakeSupabase` (`src/test/supabaseFake.ts`); edge tests use `makeFakeDeps` (`supabase/functions/_shared/testing.ts`).
- After a schema change: `supabase gen types typescript --local --schema public,graphql_public,werkbank > src/integrations/supabase/types.ts && npm run sync:mirrors`, then `npm run sync:mirrors:check && npx tsc -p tsconfig.app.json --noEmit`.
- Copy: all strings through `t()` in the `werkbank` namespace (`src/features/werkbank/i18n/{de,en}.json`), EN and DE key for key, German informal "du", no em or en dashes, no exclamation marks, no emoji. `npm run i18n:check` stays clean.
- Page conventions (CLAUDE.md): `PageHeader`, `Skeleton` while loading, `Alert variant="destructive"` on a page error, `EmptyState` with `action` or `reason`, toasts via sonner.
- `any` is banned; `npm run lint` runs with `--max-warnings 0`.
- Commits: imperative, lowercase, at most 72 characters, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before each PR: `npm run verify:fast` green; before the last PR merges: `npm run verify:full` green.
- Fixed names: routes `/customers`, `/customers/:id`, `/properties`, `/properties/:id`, `/catalog`; settings tab `?tab=numbering`; number range key `customer` with defaults prefix `K-`, `next_value` 10001, padding 0; unit codes `HUR, H87, MTR, MTK, MTQ, KGM, LTR, LS`; VAT rates 19, 7, 0; `MAX_IMPORT_ROWS` 5000; page size 1000.

## Review Focus

1. **Excel cells arrive as numbers.** A German XLSX has postal code `01067` stored as the number 1067, and a price typed as `12,50` (or the number 12.5). Expected: the postal code imports as `01067` when the country is DE, and both price forms import as 12.50. (Task 14)
2. **Optional fields cleared by the user.** Someone empties an optional field, or unticks "Abweichender Rechnungsempfänger". Expected: the database stores `null`, not `''`. Otherwise the email checks fail, and the invoice in Teil 4 would go to an empty billing name. (Task 9, Task 10)
3. **Switching customer kind on edit.** A customer is switched from Hausverwaltung to Privat while the company name is still filled. Expected: the save sends `company_name: null`, requires a last name, and the list shows "Nachname, Vorname". (Task 11)
4. **A property whose customer is archived.** Expected: the picker lists only active customers, but editing such a property still shows its archived customer and saves without forcing a change. (Task 12)
5. **Org export of a large import.** An org has more than 1000 customers. Expected: the export contains all of them, not the first 1000. (Task 4)

---

## PR 1: Database

### Task 1: Master data tables and RLS

**Files:**
- Create: `supabase/migrations/20261007140000_werkbank_master_data.sql`
- Create: `supabase/tests/werkbank/master_data.test.sql`
- Modify: `src/integrations/supabase/types.ts`, `supabase/functions/_shared/database.types.ts` (regenerated)

**Interfaces:**
- Produces: tables `werkbank.customers`, `werkbank.properties`, `werkbank.contacts`, `werkbank.catalog_items` with exactly the columns, checks and indexes of spec R1. Constraint and index names that later tasks map to messages:
  - `customers_customer_no_unique` on `(org_id, customer_no)`
  - `catalog_items_item_no_unique`, a partial unique index on `(org_id, item_no) where item_no is not null`
  - `contacts_one_parent` (the `num_nonnulls` check)
  - `contacts_primary_per_customer` and `contacts_primary_per_property` (partial unique indexes)
- Produces: `unique (org_id, id)` named `<table>_org_id_id_key` on customers and properties. Composite FKs:
  - `properties (org_id, customer_id)` on customers, `on delete restrict`
  - `contacts (org_id, customer_id)` on customers and `contacts (org_id, property_id)` on properties, both `on delete cascade`

- [ ] **Step 1: Write the failing pgTAP test** `master_data.test.sql`. Follow the setup of `supabase/tests/werkbank/org_kind.test.sql`: users inserted with `session_replication_role = replica`, `pg_temp.act_as`, `SET LOCAL ROLE authenticated`. Seed two `handwerk` orgs A and B, and in org A an admin, a producer and an artist; B gets its own admin. Assertions:
  - `has_table` for all four tables; each has RLS enabled.
  - Admin A and producer A can insert and select a customer, a property, a contact and a catalog item in org A.
  - Artist A: `is(count, 0)` on every table, and `throws_ok` insert with `42501`.
  - Admin B sees 0 rows of org A, and inserting a property in org B whose `customer_id` points at a customer of org A throws `23503`.
  - Producer A deleting a customer, property or catalog item affects 0 rows. Producer A deleting a contact succeeds.
  - `throws_ok` with `23514` for each of these:
    - an HV without `company_name`
    - a private customer without `last_name`
    - postal code `1067` with country `DE`
    - country `de`
    - email `foo`
    - `payment_terms_days` 400
    - `vat_rate` 16
    - `unit_code` `XYZ`
    - `labour_price` -1
    - `billing_name` set without `billing_city`
    - a contact with both or neither parent
  - A non-DE country accepts postal code `1010`.
  - `net_price` equals `labour_price + material_price` (40.00 + 12.50 = 52.50).
  - A second primary contact on the same customer throws `23505`.
  - Deleting a customer that has a property throws `23503`. Deleting one that has only contacts removes them.
  - Deleting org A as postgres removes all its rows from all four tables.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL (`relation "werkbank.customers" does not exist`).
- [ ] **Step 3: Write the migration.** Per table: columns per spec R1, `updated_at` trigger `execute function public.update_updated_at_column()`, `alter table ... enable row level security`, then grants and policies.
  - Grants: `grant insert, update, delete` to `authenticated`.
  - Policies, with `public.has_org_role(auth.uid(), org_id, 'admin')` as the admin predicate and the same call with `'producer'` for the producer predicate:
    - select, insert and update: admin or producer
    - delete: admin only, except contacts, where it is admin or producer
  - The DE postal-code rule is a table check: `country_code <> 'DE' or postal_code ~ '^[0-9]{5}$'`. The same rule applies to the billing address on properties.
  - The billing group check on properties: `billing_name is null` and all billing columns null, or all of `billing_name`, `billing_street`, `billing_postal_code`, `billing_city`, `billing_country_code` non-blank.
- [ ] **Step 4: Run** `npm run test:db`. Expected: PASS, including `supabase/tests/werkbank/isolation.test.sql`.
- [ ] **Step 5: Regenerate types** (Global Constraints command). Expected: `Database["werkbank"]["Tables"]` has the four tables; `tsc` clean.
- [ ] **Step 6: Commit** `add werkbank master data tables with rls`.

### Task 2: Number ranges and customer numbers

**Files:**
- Create: `supabase/migrations/20261007150000_werkbank_number_ranges.sql`
- Create: `supabase/tests/werkbank/number_ranges.test.sql`
- Modify: types (regenerated)

**Interfaces:**
- Consumes: `werkbank.customers` (Task 1).
- Produces:
  - table `werkbank.number_ranges (org_id, key, prefix, next_value, padding)` per spec R2. RLS: select for admin or producer; insert and update for admin only.
  - `werkbank.next_number(p_org uuid, p_key text) returns text`: `security definer`, `set search_path = ''`, execute revoked from `public`, `anon` and `authenticated`.
  - trigger `customers_assign_no` (`before insert`) calling `werkbank.assign_customer_no()` (`security definer`, `set search_path = ''`, execute revoked from `public` and `anon`).

- [ ] **Step 1: Write the failing pgTAP test.** Assertions:
  - Admin A inserting two customers without `customer_no` yields `K-10001` and `K-10002`.
  - A customer inserted with `customer_no = 'ALT-7'` keeps it and consumes no number: the next generated one is `K-10003`.
  - Inside a savepoint, an insert that fails a check and is rolled back does not consume a number.
  - With admin A setting `prefix = 'KD'`, `next_value = 5` and `padding = 4`, the next customer gets `KD0005`.
  - Producer A updating `number_ranges` affects 0 rows.
  - `authenticated` calling `werkbank.next_number` throws `42501`.
  - `next_number(org, 'unknown')` as postgres throws `22023`.
  - Org B's first customer gets `K-10001`, so ranges are per org.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL.
- [ ] **Step 3: Write the migration.** `next_number`:
  1. `insert ... values (p_org, 'customer', 'K-', 10001, 0) on conflict do nothing` when `p_key = 'customer'`; any other key without a row raises `22023`.
  2. `select prefix, next_value, padding ... for update`.
  3. `update ... set next_value = next_value + 1`.
  4. Return `prefix || lpad(v::text, greatest(padding, length(v::text)), '0')`.

  `assign_customer_no` sets `new.customer_no` only when it is null.
- [ ] **Step 4: Run** `npm run test:db`. Expected: PASS, isolation test included.
- [ ] **Step 5: Regenerate types, commit** `add werkbank number ranges and customer numbers`.

### Task 3: Import RPCs

**Files:**
- Create: `supabase/migrations/20261007160000_werkbank_import_rpcs.sql`
- Create: `supabase/tests/werkbank/import_rpcs.test.sql`
- Modify: types (regenerated)

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `werkbank.import_customers(p_org uuid, p_rows jsonb) returns jsonb`, `werkbank.import_properties(p_org uuid, p_rows jsonb) returns jsonb`, `werkbank.import_catalog_items(p_org uuid, p_rows jsonb) returns jsonb`.
  - All are `security definer` with `set search_path = ''`. Execute is revoked from `public` and `anon` and granted to `authenticated`.
  - Input: a JSON array of objects whose keys are the table's column names. Property rows carry `customer_no` instead of `customer_id`. Unknown keys are ignored.
  - Output: a JSON array with one entry per input row, in order: `{"row": <0-based index>, "status": "created" | "skipped" | "error", "reason": null | "customer_no_taken" | "item_no_taken" | "unknown_customer" | "invalid", "detail": null | <constraint name or sqlerrm>}`.
  - A caller who is neither admin nor producer of `p_org` raises `42501`.

- [ ] **Step 1: Write the failing pgTAP test.** Assertions:
  - Producer A imports 3 customers: one with `customer_no` `K-20000`, one without, one HV without `company_name`. Result statuses are `created`, `created`, `error/invalid`, and `detail` names the failing check.
  - Afterwards `next_value` is 20001, so a new customer gets `K-20001`.
  - Re-importing `K-20000` gives `skipped/customer_no_taken`. The row is unchanged.
  - Properties: a row with a known `customer_no` is created; an unknown one gives `error/unknown_customer`.
  - Catalog: a duplicate `item_no` gives `skipped/item_no_taken`, and `unit_code` `XYZ` gives `error/invalid`.
  - An artist of A and the admin of B calling any of the three RPCs for org A throw `42501`.
  - An imported `customer_no` `ALT-7`, which does not match the prefix, leaves `next_value` unchanged.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL.
- [ ] **Step 3: Write the migration.** Loop `for i, r in jsonb_array_elements(p_rows) with ordinality`. Each row runs in a `begin ... exception` block, and the block catches the errors as follows:

  | Error | Result |
  |---|---|
  | `unique_violation` | `skipped`, reason from the constraint name |
  | `check_violation`, `not_null_violation` or `invalid_text_representation` | `error/invalid` with `detail` the constraint name, else `sqlerrm` |

  Insert with `jsonb_populate_record(null::werkbank.<table>, r)` and override `org_id`, `id`, `created_at` and `updated_at`.

  After the customer loop, raise the range with this statement:
  ```sql
  update werkbank.number_ranges nr set next_value = greatest(nr.next_value, m.max_no + 1)
  from (select max(substr(c.customer_no, length(nr2.prefix) + 1)::bigint) as max_no
        from werkbank.customers c join werkbank.number_ranges nr2 on nr2.org_id = c.org_id and nr2.key = 'customer'
        where c.org_id = p_org and left(c.customer_no, length(nr2.prefix)) = nr2.prefix
          and substr(c.customer_no, length(nr2.prefix) + 1) ~ '^[0-9]{1,18}$') m
  where nr.org_id = p_org and nr.key = 'customer' and m.max_no is not null;
  ```
  Before the customer loop, make sure the range row exists without consuming a number: `insert into werkbank.number_ranges (org_id, key, prefix, next_value, padding) values (p_org, 'customer', 'K-', 10001, 0) on conflict do nothing`. In `import_properties`, look up `customer_id` by `(p_org, r->>'customer_no')` first; no match records `error/unknown_customer` without attempting the insert.
- [ ] **Step 4: Run** `npm run test:db`. Expected: PASS, isolation test included.
- [ ] **Step 5: Regenerate types, commit** `add werkbank import rpcs`.

### Task 4: Org export includes Werkbank tables

**Files:**
- Modify: `supabase/functions/export-org-data/index.ts`, `supabase/functions/export-org-data/index.test.ts`
- Modify: `supabase/functions/_shared/testing.ts` (fake admin client gains `schema(name)`)
- Modify: `scripts/moduleIsolation.test.ts` (allow `supabase/functions/export-org-data/index.ts` and `.../index.test.ts`)

**Interfaces:**
- Produces: the bundle gains a `werkbank` key: `{ customers: Row[], properties: Row[], contacts: Row[], catalog_items: Row[], number_ranges: Row[] }`, all filtered by `org_id`.

- [ ] **Step 1: Write the failing Deno tests** in `index.test.ts`:
  - The bundle has `werkbank.customers` from the seeded fake schema `werkbank`.
  - The fake was queried with `eq("org_id", orgId)`.
  - The fake returns 1000 rows for range 0 to 999 and 3 rows for 1000 to 1999, and `bundle.werkbank.customers.length === 1003`.
  - A read error on a werkbank table returns 500 `Failed to read werkbank.customers`.
- [ ] **Step 2: Run** `npm run test:functions -- supabase/functions/export-org-data/`. Expected: FAIL.
- [ ] **Step 3: Implement.** Add the list:
  ```ts
  const WERKBANK_TABLES = ["customers","properties","contacts","catalog_items","number_ranges"] as const satisfies readonly (keyof Database["werkbank"]["Tables"])[];
  ```
  Each table is read with `admin.schema("werkbank").from(t).select("*").eq("org_id", orgId).order("id").range(from, from + 999)` until a batch has fewer than 1000 rows. Extend the fake's `schema()` the same way as `from()`: seeds keyed `werkbank.<table>`, and `range()` recorded so seeds can match on it.
- [ ] **Step 4: Run** the Deno tests, `deno check --node-modules-dir=none supabase/functions/export-org-data/index.ts` and `npx vitest run scripts/moduleIsolation.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `export werkbank tables with the org data`.

---

## PR 2: Catalog and numbering

### Task 5: Shared Werkbank helpers

**Files:**
- Modify: `src/test/supabaseFake.ts` (+ its test, if one exists, else `src/test/supabaseFake.test.ts`)
- Create: `src/features/werkbank/lib/fetchAllPages.ts`, `lib/dbErrors.ts`, `lib/units.ts`, `lib/blankToNull.ts`, `lib/displayName.ts`, each with a `.test.ts`
- Modify: `src/features/werkbank/i18n/{de,en}.json`

**Interfaces:**
- Produces:
  - `createFakeSupabase(seed).schema(name)` returns `{ from, rpc }`, which record calls with `table` = `"<name>.<table>"` and `"rpc:<name>.<fn>"`. They resolve seeds under those keys, and the existing `from`/`rpc` behaviour is unchanged.
  - `fetchAllPages<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, pageSize = 1000): Promise<T[]>` throws the first error.
  - `mapDbError(error: unknown): DbErrorKey`, where `type DbErrorKey = "errors.customerNoTaken" | "errors.itemNoTaken" | "errors.inUse" | "errors.forbidden" | "errors.generic"`:
    - code `23505` with message or details containing `customers_customer_no_unique` gives `customerNoTaken`
    - code `23505` containing `catalog_items_item_no_unique` gives `itemNoTaken`
    - code `23503` gives `inUse`
    - code `42501`, or PostgREST `PGRST301`, gives `forbidden`
    - anything else gives `generic`
  - `UNIT_CODES = ["HUR","H87","MTR","MTK","MTQ","KGM","LTR","LS"] as const`, `type UnitCode`, `unitLabelKey(code: UnitCode): string` returning `units.<code>`.
  - `blankToNull<T extends Record<string, unknown>>(values: T): { [K in keyof T]: T[K] extends string ? string | null : T[K] }` trims strings; empty becomes `null`.
  - `customerDisplayName(c: { kind: "property_manager" | "private"; company_name: string | null; first_name: string | null; last_name: string | null }): string`. An HV returns `company_name`; a private customer returns `"last, first"`, or `last` alone when there is no first name.
  - i18n keys: `errors.*` (the copy of spec R8), `units.*`, with DE labels `Std, Stk, m, m², m³, kg, l, pauschal` and EN labels `h, pc, m, m², m³, kg, l, lump sum`. `common.archive`, `common.restore`, `common.delete`, `common.edit`, `common.cancel`, `common.save`, `common.showArchived`, `common.search`.
- [ ] **Step 1: Write the failing tests:**
  - The fake `schema("werkbank").from("customers")` resolves the `"werkbank.customers"` seed and records the call.
  - `fetchAllPages` with a stub returning 1000, 1000 and 5 rows calls ranges (0,999), (1000,1999), (2000,2999) and returns 2005 rows. It stops after the first empty batch and rethrows the error.
  - Each `mapDbError` case above.
  - `blankToNull({ a: " ", b: "x ", c: 3 })` equals `{ a: null, b: "x", c: 3 }`.
  - `customerDisplayName` for both kinds, including private without a first name.
  - Every `UNIT_CODES` entry has `units.<code>` in both language files.
- [ ] **Step 2: Run** `npx vitest run src/features/werkbank/lib src/test`. Expected: FAIL.
- [ ] **Step 3: Implement** the six modules and the copy.
- [ ] **Step 4: Run** the same tests and `npm run i18n:check`. Expected: PASS.
- [ ] **Step 5: Commit** `add werkbank paging, error, unit and name helpers`.

### Task 6: Catalog data, schema and hooks

**Files:**
- Create: `src/features/werkbank/schemas/catalogItem.ts` (+ `.test.ts`), `data/catalog.ts` (+ `.test.ts`), `hooks/useCatalog.ts` (+ `.test.tsx`)

**Interfaces:**
- Consumes: Task 5 helpers; `Database["werkbank"]["Tables"]["catalog_items"]`.
- Produces:
  - `type CatalogItem = Database["werkbank"]["Tables"]["catalog_items"]["Row"]`
  - `catalogItemSchema(t: TFunction)`: a zod object with these fields:
    - `item_no`, `name` (required), `description`, `category`
    - `unit_code` (enum `UNIT_CODES`)
    - `labour_price` and `material_price`: strings, parsed with comma or dot, at most 2 decimals, ≥ 0
    - `vat_rate`: one of `"19" | "7" | "0"`

    `type CatalogItemForm = z.infer<...>`
  - `toCatalogItemRow(form: CatalogItemForm): Database["werkbank"]["Tables"]["catalog_items"]["Insert"]` without `org_id` (prices to numbers, `blankToNull`)
  - `fetchCatalogItems(client, orgId): Promise<CatalogItem[]>`, ordered by `name`, all pages
  - `createCatalogItem(client, orgId, form)`, `updateCatalogItem(client, id, form)`, `setCatalogItemArchived(client, id, archived: boolean)`, `deleteCatalogItem(client, id)`, all throwing on error
  - hooks `useCatalogItems()`, `useCreateCatalogItem()`, `useUpdateCatalogItem()`, `useArchiveCatalogItem()`, `useDeleteCatalogItem()`. Query key `["werkbank","catalog",orgId]`. Mutations toast `t(mapDbError(e))` on error and invalidate `["werkbank","catalog"]`.
- [ ] **Step 1: Write the failing tests:**
  - The schema accepts `"12,50"` and `"12.5"`, which become 12.5 in `toCatalogItemRow`. It rejects `"-1"`, `"1,234"` (3 decimals), unit `"XYZ"` and an empty name.
  - `fetchCatalogItems` queries `werkbank.catalog_items` with `eq("org_id", "org-1")` and `order("name")`.
  - `updateCatalogItem` sends `blankToNull` values, so `description: ""` becomes `null`.
  - The archive hook sends `archived_at` as an ISO string, or `null` to restore.
  - A failing create hook toasts the `errors.itemNoTaken` copy for a `23505` on `catalog_items_item_no_unique`.
- [ ] **Step 2: Run** `npx vitest run src/features/werkbank/schemas src/features/werkbank/data/catalog.test.ts src/features/werkbank/hooks/useCatalog.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** in the style of `data/technicians.ts` and `hooks/useTechnicians.ts`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `add werkbank catalog data layer`.

### Task 7: Catalog page

**Files:**
- Create: `src/features/werkbank/pages/CatalogPage.tsx` (+ `.test.tsx`), `components/CatalogItemFormDialog.tsx` (+ `.test.tsx`), `components/DeleteConfirmDialog.tsx`, `components/ArchiveSwitch.tsx`
- Modify: `src/features/werkbank/paths.ts` (`CATALOG_PATH = "/catalog"`), `ui.ts`, `ui.test.ts`, `i18n/{de,en}.json` (`nav.catalog` "Leistungen" / "Services", `catalog.*`)

**Interfaces:**
- Consumes: Task 6 hooks.
- Produces:
  - `DeleteConfirmDialog({ open, onOpenChange, title, body, onConfirm, pending })` and `ArchiveSwitch({ checked, onCheckedChange })`, which Tasks 11 to 13 reuse.
  - Nav item and route `/catalog` (`kinds: ["handwerk"]`, roles admin and producer, icon `Wrench`), placed before the technicians item.
- [ ] **Step 1: Write the failing tests:**
  - **CatalogPage:**
    - rows render Nr., Name, Kategorie, Einheit (DE label), Lohn, Material, Netto and MwSt.; amounts are formatted with `formatMoney(..., "EUR", "de-DE")`
    - the search filters on number, name and description
    - the Kategorie filter lists the distinct categories
    - archived items are hidden until `ArchiveSwitch` is on
    - the empty state shows the "Leistung anlegen" action
    - the delete action is visible only with role admin
    - a loading `Skeleton` and an error `Alert` render as expected
  - **CatalogItemFormDialog:** the live net total shows `52,50 €` for labour `40` and material `12,50`; submitting calls create; editing prefills and calls update.
  - **`ui.test.ts`:** `/catalog` is a handwerk route for admin and producer.
- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement** the page, the dialog (react-hook-form with `zodResolver(catalogItemSchema(t))`, `form.reset` on close, the double-submit guard as in `AddTechnicianDialog`), the two shared components and the registration. Add `<PageMini>` later (Task 18).
- [ ] **Step 4: Run** the tests and `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `add the werkbank catalog page`.

### Task 8: Number ranges settings tab

**Files:**
- Create: `src/features/werkbank/data/numberRanges.ts` (+ test), `hooks/useNumberRanges.ts`, `components/NumberingTab.tsx` (+ test)
- Modify: `src/lib/settingsTabs.ts` (+ test), `src/pages/SettingsPage.tsx`, `src/i18n/locales/{en,de}/settings.json` (`nav.items.numbering`: "Nummernkreise" / "Numbering"), `eslint.config.js` (allow `src/pages/SettingsPage.tsx` to import `@/features/werkbank/components/NumberingTab`), `scripts/moduleIsolation.test.ts` (allow `src/lib/settingsTabs.ts`, its test and `src/pages/SettingsPage.tsx`)

**Interfaces:**
- Produces:
  - `fetchNumberRange(client, orgId, key: "customer"): Promise<{ prefix: string; next_value: number; padding: number }>`. A missing row returns the defaults `K-`, 10001 and 0.
  - `saveNumberRange(client, orgId, key, values)`: an upsert on `(org_id, key)`.
  - `formatNumber(prefix, value, padding): string`, identical to the SQL formatting in Task 2.
  - `NumberingTab` with prefix and next-number inputs, the live preview "Nächste Kundennummer: K-10001" and save.
  - Settings tab value `numbering`, in `SETTINGS_TAB_PARAMS` and `SETTINGS_TAB_KINDS.numbering = ["handwerk"]`, shown for admins only (gated like `permissions`).
- [ ] **Step 1: Write the failing tests:**
  - `formatNumber("KD", 5, 4) === "KD0005"` and `formatNumber("K-", 10001, 0) === "K-10001"`.
  - `fetchNumberRange` returns the defaults for an empty result.
  - `isSettingsTabAllowedForKind("numbering", "handwerk")` is true and false for `production`.
  - A producer deep link `?tab=numbering` falls back to the default tab.
  - `NumberingTab` shows the preview and saves `next_value` as a number. It rejects `next_value` 0 and a prefix longer than 10 characters.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Add `{ value: "numbering", label: t('nav.items.numbering'), icon: Hash, show: isAdmin }` to the organization group and the matching `TabsContent`.
- [ ] **Step 4: Run** `npx vitest run src/lib/settingsTabs.test.ts src/features/werkbank scripts/moduleIsolation.test.ts src/pages/SettingsPage.test.tsx` and `npm run lint`. Expected: PASS, and existing settings tests unchanged.
- [ ] **Step 5: Commit** `add the numbering settings tab for handwerk orgs`.

---

## PR 3: Customers, properties, contacts

### Task 9: Customers data, schema and hooks

**Files:**
- Create: `src/features/werkbank/schemas/address.ts`, `schemas/customer.ts` (+ tests), `data/customers.ts` (+ test), `hooks/useCustomers.ts` (+ test)

**Interfaces:**
- Produces:
  - `addressFields(t)`: a zod shape `{ street, postal_code, city, country_code }` plus `refineAddress(prefix?: "billing_")`. The refinement enforces the DE 5-digit postal code and `country_code` matching `^[A-Z]{2}$`. Task 10 reuses both.
  - `customerSchema(t)`, with fields:
    - `kind`, `company_name`, `first_name`, `last_name`
    - the address fields
    - `email`, `invoice_email`, `phone`, `vat_id`
    - `payment_terms_days`: a string of digits, 0 to 365
    - `notes`
    - `customer_no`: optional
  - Rules: `company_name` is required for `property_manager`, `last_name` for `private`. Email and VAT patterns equal the SQL checks.
  - `toCustomerRow(form)`: with `kind === "private"` it sends `company_name: null`; with `property_manager` it keeps the names as entered. Applies `blankToNull`.
  - `type CustomerListRow = Customer & { property_count: number }`.
  - Data functions:
    - `fetchCustomers(client, orgId): Promise<CustomerListRow[]>`: select `*, properties(count)`, all pages
    - `fetchCustomer(client, id): Promise<Customer | null>`
    - `createCustomer(client, orgId, form): Promise<Customer>`: returns the row, including the assigned `customer_no`
    - `updateCustomer`, `setCustomerArchived`, `deleteCustomer`
  - Hooks with keys `["werkbank","customers",orgId]` and `["werkbank","customers","detail",id]`.
- [ ] **Step 1: Write the failing tests:**
  - **Schema cases:**
    - an HV without company name, and a private customer without last name, are rejected
    - `01067` with DE passes, `1067` with DE fails, `1010` with AT passes
    - `invoice_email: "x"` fails
    - `payment_terms_days: "400"` fails
  - **`toCustomerRow`:**
    - a private customer with a leftover `company_name: "Alt GmbH"` sends `null`
    - an empty `vat_id` sends `null`
    - an empty `customer_no` is omitted, so the trigger assigns one
  - **`fetchCustomers`:** maps `properties: [{ count: 2 }]` to `property_count: 2`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `add werkbank customers data layer`.

### Task 10: Properties and contacts data, schema and hooks

**Files:**
- Create: `schemas/property.ts`, `schemas/contact.ts`, `data/properties.ts`, `data/contacts.ts`, `hooks/useProperties.ts`, `hooks/useContacts.ts` (each with a test)

**Interfaces:**
- Consumes: `addressFields`, `refineAddress` (Task 9).
- Produces:
  - **`propertySchema(t)`:**
    - fields `customer_id` (uuid, required), `name` (required), `object_no`, the address fields, `has_billing: boolean`, the billing address fields, `access_notes`, `notes`
    - when `has_billing` is set, all billing fields are required and refined with the `billing_` prefix
  - **`toPropertyRow(form)`:** with `has_billing === false` every `billing_*` field is `null`; the `has_billing` key itself is never sent.
  - **Property data and hooks:**
    - `type PropertyListRow = Property & { customer: Pick<Customer, "id" | "kind" | "company_name" | "first_name" | "last_name" | "archived_at"> }`
    - `fetchProperties(client, orgId)` selects `*, customer:customers(id, kind, company_name, first_name, last_name, archived_at)` across all pages; `fetchProperty(client, id)` returns `PropertyListRow | null`.
    - The customer's properties come from `fetchPropertiesForCustomer(client, customerId)`.
    - `createProperty`, `updateProperty`, `setPropertyArchived` and `deleteProperty` write the row.
    - Query keys: `["werkbank","properties",orgId]` and `["werkbank","properties","detail",id]`. A property mutation also invalidates `["werkbank","customers"]`, because the property counts change.
  - **`contactSchema(t)`:** `first_name`, `last_name` (required), `role`, `phone`, `mobile`, `email`, `notes`, `is_primary`.
  - **Contact data and hooks:**
    - `type ContactParent = { customerId: string } | { propertyId: string }`
    - `fetchContacts(client, parent)`, ordered by `is_primary desc, last_name`.
    - `createContact(client, orgId, parent, form)` sets exactly one parent column; `updateContact` and `deleteContact` write the row.
    - When a contact becomes primary, `setPrimaryContact(client, parent, id)` first clears the other primary of that parent, then sets this one.
    - Query key: `["werkbank","contacts", "customer" | "property", parentId]`.
- [ ] **Step 1: Write the failing tests:**
  - Unticking `has_billing` with leftover billing values gives all-null `billing_*`.
  - `has_billing` with an empty city is rejected.
  - `createContact` with `{ propertyId }` sends `property_id` and `customer_id: null`.
  - `setPrimaryContact` issues the clear before the set.
  - `fetchProperties` asks for the customer join.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `add werkbank properties and contacts data layer`.

### Task 11: Customers list and customer form

**Files:**
- Create: `pages/CustomersPage.tsx` (+ test), `components/CustomerFormDialog.tsx` (+ test), `components/CountryField.tsx`
- Modify: `paths.ts` (`CUSTOMERS_PATH = "/customers"`, `customerPath(id)`), `ui.ts`, `ui.test.ts`, i18n (`nav.customers` "Kunden" / "Customers", `customers.*`, `kind.property_manager` "Hausverwaltung" / "Property manager", `kind.private` "Privat" / "Private")

**Interfaces:**
- Consumes: Task 9 hooks, `DeleteConfirmDialog`, `ArchiveSwitch`, `customerDisplayName`.
- Produces:
  - `CustomerFormDialog({ open, onOpenChange, customer?: Customer })`
  - `CountryField`: a select with Deutschland, Österreich and Schweiz (`DE`, `AT`, `CH`) plus a free two-letter input. Task 12 reuses it.
  - Nav item first in the Werkbank group, icon `Building2`. Route `/customers`; Task 13 adds `/customers/:id`.
- [ ] **Step 1: Write the failing tests:**
  - **CustomersPage:**
    - columns as in spec R5; the Art column renders as a `StatusPill`
    - the search matches name, number, city and email after the debounce (use fake timers)
    - the Art filter
    - the archive switch
    - the empty state for producers shows the action
    - a row click navigates to `customerPath(id)`
    - no "Importieren" action yet (Task 15 adds it)
  - **CustomerFormDialog:**
    - toggling the kind swaps company name for first and last name
    - switching an existing HV to Privat submits `company_name: null` (Review Focus 3)
    - a successful create toasts the assigned customer number
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests and lint. Expected: PASS.
- [ ] **Step 5: Commit** `add the werkbank customers page`.

### Task 12: Properties list, property detail, property form and contacts

**Files:**
- Create: `pages/PropertiesPage.tsx`, `pages/PropertyDetailPage.tsx`, `components/PropertyFormDialog.tsx`, `components/CustomerPicker.tsx`, `components/ContactsSection.tsx`, `components/ContactFormDialog.tsx` (each with a test where it has logic)
- Modify: `paths.ts` (`PROPERTIES_PATH = "/properties"`, `propertyPath(id)`), `ui.ts`, `ui.test.ts`, i18n (`nav.properties` "Liegenschaften" / "Properties", `properties.*`, `contacts.*`)

**Interfaces:**
- Consumes: Tasks 9 and 10 hooks, `CountryField` (Task 11), `DeleteConfirmDialog`, `ArchiveSwitch`.
- Produces:
  - `PropertyFormDialog({ open, onOpenChange, property?: Property, customerId?: string })` and `ContactsSection({ parent: ContactParent })`, both reused by Task 13.
  - Nav item after Kunden, icon `Home`. Routes `/properties` and `/properties/:id`.
- [ ] **Step 1: Write the failing tests:**
  - **PropertiesPage:** columns Name, Objekt-Nr., Adresse and Kunde. The search covers name, object number, street, postal code, city and customer name ("Musterstr" finds "Musterstraße 5"). Archive switch.
  - **PropertyDetailPage:** the "Rechnung geht an" box shows the customer when no billing name is set, and "WEG Musterstr. 5, vertreten durch Hausverwaltung Müller" when one is set. It renders access notes and `ContactsSection` with `{ propertyId }`. An unknown id shows a not-found empty state linking to `/properties`.
  - **CustomerPicker:** lists only active customers, but includes the currently selected archived customer marked "archiviert" (Review Focus 4).
  - **PropertyFormDialog:** the billing checkbox reveals the fields; unticking it saves null billing fields; `customerId` preselects.
  - **ContactsSection:**
    - lists the primary contact first, with the badge "Hauptansprechpartner"
    - create, edit and delete work through `ContactFormDialog`
    - delete asks for confirmation
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests and lint. Expected: PASS.
- [ ] **Step 5: Commit** `add the werkbank properties pages and contacts`.

### Task 13: Customer detail page

**Files:**
- Create: `pages/CustomerDetailPage.tsx` (+ test)
- Modify: `ui.ts` (route `/customers/:id`), i18n (`customerDetail.*`)

**Interfaces:**
- Consumes: Task 9 hooks, `fetchPropertiesForCustomer` (Task 10), `PropertyFormDialog`, `ContactsSection` (Task 12), `CustomerFormDialog` (Task 11).
- [ ] **Step 1: Write the failing tests:**
  - **Header:** shows name, number and kind. "Löschen" appears only for admins. An archived customer shows "Wiederherstellen".
  - **Delete:** deleting a customer with properties shows the `errors.inUse` toast.
  - **Stammdaten:** shows the address and the payment terms "14 Tage".
  - **Properties section:** lists the customer's properties and opens `PropertyFormDialog` with the customer preselected.
  - **Contacts:** renders `ContactsSection` with `{ customerId }`.
  - **Unknown id:** shows the not-found empty state with a link back to `/customers`.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `add the werkbank customer detail page`.

---

## PR 4: Import

### Task 14: Generic import pipeline

**Files:**
- Create: `src/features/werkbank/import/types.ts`, `import/guessColumns.ts`, `import/normalizeCell.ts`, `import/validateRows.ts`, `import/specs.ts` (each with a test), `components/import/ImportDialog.tsx` (+ test)

**Interfaces:**
- Consumes: `parseSheet`, `MAX_IMPORT_ROWS` from `src/lib/artistImport/parseSheet.ts`; the zod schemas of Tasks 6, 9 and 10.
- Produces:
  - Types:
    ```ts
    interface ImportField { key: string; labelKey: string; required: boolean; aliases: string[]; kind: "text" | "money" | "postal_code" | "integer" | "enum" }
    interface ImportSpec<F> { entity: "customers" | "properties" | "catalog_items"; fields: ImportField[]; schema: (t: TFunction) => ZodType<F>; toRpcRow: (form: F) => Record<string, unknown>; run: (client, orgId, rows) => Promise<ImportResult[]> }
    type ImportResult = { row: number; status: "created" | "skipped" | "error"; reason: "customer_no_taken" | "item_no_taken" | "unknown_customer" | "invalid" | null; detail: string | null }
    ```
  - `guessColumns(headers: string[], fields: ImportField[]): Record<string, number | null>`: a case-, space- and umlaut-insensitive match of headers against `aliases`, each header used at most once.
  - `normalizeCell(value: unknown, kind: ImportField["kind"], countryCode?: string): string`:
    - `money`: accepts the number 12.5, `"12,50"`, `"12.50"` and `"1.234,50"`, and returns `"12.50"` or `"1234.50"`
    - `postal_code`: left-pads a numeric value to 5 digits when the country is DE
    - `integer`: the number 14 becomes `"14"`
    - `enum`: maps German labels to codes. Kind: Hausverwaltung or HV becomes `property_manager`, Privat becomes `private`. Units: the DE labels from Task 5 become their codes. VAT: "19 %" becomes `19`.
  - `validateRows<F>(rows: string[][], mapping, spec, t): { valid: { index: number; form: F }[]; invalid: { index: number; messages: string[] }[] }`. At most `MAX_IMPORT_ROWS` rows; anything beyond is reported as one invalid entry.
  - `CUSTOMER_IMPORT`, `PROPERTY_IMPORT` and `CATALOG_IMPORT` specs. The property spec's `customer_no` field is required, and `toRpcRow` replaces `customer_id` with `customer_no`.
  - `ImportDialog<F>({ spec, open, onOpenChange, onDone })` runs the steps upload, map, review, import and summary. The summary reads "X importiert, Y übersprungen, Z Fehler" and lists the reasons as `import.reasons.<reason>` copy. The properties variant shows the hint "Importiere zuerst die Kunden".
- [ ] **Step 1: Write the failing tests:**
  - **guessColumns:** "PLZ", "Postleitzahl" and "plz " map to `postal_code`; "Straße" and "Strasse" map to `street`; "Firma" maps to `company_name`; "Kundennr." maps to `customer_no`.
  - **normalizeCell:** the money cases, postal code `1067` with DE gives `01067` (Review Focus 1), the enum cases.
  - **validateRows:** a row missing the required `last_name` for Privat lands in `invalid` with the schema message; 5001 rows report the overflow.
  - **ImportDialog** (with a fake spec and a CSV string fixture):
    - a mapping step with prefilled selects
    - review counts
    - the summary built from mocked `run` results, including a `customer_no_taken` reason
    - `onDone` is called once
- [ ] **Step 2: Run** `npx vitest run src/features/werkbank/import src/features/werkbank/components/import`. Expected: FAIL.
- [ ] **Step 3: Implement.** Aliases per field: German and English common headers. Keep the alias lists in `specs.ts`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `add the werkbank import pipeline`.

### Task 15: Wire the three importers

**Files:**
- Create: `src/features/werkbank/data/imports.ts` (+ test)
- Modify: `pages/CustomersPage.tsx`, `pages/PropertiesPage.tsx`, `pages/CatalogPage.tsx` (+ their tests), `import/specs.ts`

**Interfaces:**
- Produces: `importCustomers(client, orgId, rows)`, `importProperties(...)` and `importCatalogItems(...)`. Each calls `client.schema("werkbank").rpc("import_<entity>", { p_org: orgId, p_rows: rows })` and returns `ImportResult[]`, throwing on error. On done, the dialog invalidates `["werkbank", <entity>]` and, for properties, `["werkbank","customers"]`.
- [ ] **Step 1: Write the failing tests:**
  - `importCustomers` calls `rpc:werkbank.import_customers` with `p_org` and `p_rows`.
  - Each page's "Importieren" button opens `ImportDialog` with its spec.
  - The properties page has an "Importieren" header action, like the other two.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `wire werkbank imports into the list pages`.

---

## PR 5: Start list, help, minis, changelog, e2e

### Task 16: Dashboard start list

**Files:**
- Create: `src/features/werkbank/data/startList.ts` (+ test), `hooks/useStartList.ts`, `components/StartList.tsx` (+ test)
- Modify: `components/WerkbankDashboard.tsx` (+ test), i18n (`dashboard.*`)

**Interfaces:**
- Produces: `fetchStartCounts(client, orgId): Promise<{ technicians: number; catalogItems: number; customers: number }>`, using `select("id", { count: "exact", head: true })` on `artists` (public) and on `werkbank.catalog_items` and `werkbank.customers`, archived rows excluded.
- [ ] **Step 1: Write the failing tests:**
  - **Steps:** three steps in the order Monteure, Leistungen, Kunden, linking to `/technicians`, `/catalog` and `/customers`. Each step with a count above 0 shows as done and displays the count.
  - **Roles:** a technician (`artist` role) sees only the welcome text, not the steps.
  - **`fetchStartCounts`:** passes `is("archived_at", null)` for the werkbank tables.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `turn the werkbank dashboard into a start list`.

### Task 17: Help center for handwerk

**Files:**
- Modify: `src/lib/help/types.ts`, `src/lib/help/filter.ts` (+ test), `src/lib/help/items.ts` (+ `items.test.ts`), `src/pages/HelpPage.tsx`, `src/components/layout/navItems.ts`, `src/config/app.config.ts` (`ROUTE_KINDS['/help']`), `src/lib/orgKind.ts` (`CORE_ORG_KINDS`), `scripts/moduleIsolation.test.ts` (allow `src/lib/help/items.ts`, `src/lib/help/items.test.ts`, `src/lib/help/filter.test.ts`, `src/components/layout/navItems.ts`, `src/config/app.config.ts`, plus any test file that now names `handwerk`)

**Interfaces:**
- Produces:
  - `HelpItem.kinds?: readonly OrgKind[]`. An item without `kinds` belongs to `CORE_ORG_KINDS`, defined as `["production", "staffing"] as const satisfies readonly CoreOrgKind[]`.
  - `selectItems` and `countParams` gain a `kind: OrgKind` filter. `countParams(role, filter, query, kind, matched?)` counts only the kind's items.
  - The Help nav item and `/help` route are allowed for `handwerk`. `HelpGlossary` renders only for core kinds.
- [ ] **Step 1: Write the failing tests:**
  - **`selectItems`:** with `"handwerk"` it returns only items flagged `kinds: ["handwerk"]`; with `"production"` its result is unchanged from today (snapshot the ids).
  - **`countParams`:** totals are per kind.
  - **`items.test.ts`:** existing invariants (unique ids, both languages, stage range) hold for the new items. Every handwerk item uses only `role` `admin` or `producer`.
  - **Coverage:** handwerk items exist for customers, properties, contacts, catalog (one answer explains §35a and one the units), import and number ranges.
- [ ] **Step 2: Run** `npx vitest run src/lib/help`. Expected: FAIL.
- [ ] **Step 3: Implement.** Write about 10 items: role `admin` and `producer`, stages 3 and 4, `surface` the German page name, "Du", no dashes.
- [ ] **Step 4: Run** `npx vitest run src/lib/help src/components/help src/pages scripts/moduleIsolation.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `show werkbank help items to handwerk orgs`.

### Task 18: Page minis for the list pages

**Files:**
- Create: `src/lib/minis/pages/{customers,properties,catalog}.ts`, `src/components/minis/illustrations/{Customers,Properties,Catalog}Mini.tsx`
- Modify: `src/lib/minis/types.ts` (`PageKey` gains `'customers' | 'properties' | 'catalog'`), `src/lib/minis/index.ts`, `src/components/minis/illustrations/index.ts`, `CustomersPage.tsx`, `PropertiesPage.tsx`, `CatalogPage.tsx`, existing minis tests if they enumerate keys

**Interfaces:**
- Produces: `<PageMini page="customers" />` and the other two, placed between `PageHeader` and the page body. The mini files must not contain the words `werkbank` or `handwerk`, so they need no allow-list entry.
- [ ] **Step 1: Write the failing test:** the existing minis registry test (or a new `src/lib/minis/index.test.ts`) asserts that `MINIS` and `ART` cover the three new keys. Each Werkbank list page test asserts that the mini renders.
- [ ] **Step 2: Run** `npx vitest run src/lib/minis src/components/minis src/features/werkbank/pages`. Expected: FAIL.
- [ ] **Step 3: Implement.** Copy for admin and producer, 3 to 4 steps each:
  - customers: HV or Privat, then numbers, then properties, then contacts
  - properties: property, then invoice recipient, then on-site contacts
  - catalog: unit, then labour and material (§35a), then VAT, then snapshot into quotes

  Use plain words, not `{{show}}` vocabulary placeholders.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `add page minis for the werkbank list pages`.

### Task 19: Werkbank changelog

**Files:**
- Modify: `public/changelog.md`, `public/changelog.json` (regenerated), any test that asserts the Showflow changelog content

- [ ] **Step 1: Run** `git grep -n "changelog" -- 'src/**/*.test.*' 'scripts/**/*.test.*'` to find tests depending on the old content. Note what they assert, such as the format or the latest version.
- [ ] **Step 2: Replace** `public/changelog.md` with a "# Werkbank Digital — Changelog" header, the line "Was neu ist in Werkbank Digital, neueste Einträge zuerst.", and one entry. Use version `1.0.0` with today's date and the tagline "Deine Stammdaten an einem Ort". Under "### Neu" it lists Kunden, Liegenschaften, Ansprechpartner, Leistungskatalog and Import, one bold item per line, in the same Markdown shape as the old file so the parser accepts it. Use no em dashes except in the header line, whose format the parser expects; check that against `scripts/changelog-to-json.ts`.
- [ ] **Step 3: Regenerate** with `deno run --allow-read --allow-write scripts/changelog-to-json.ts` and update any test from Step 1 to the new content.
- [ ] **Step 4: Run** `npm run test` for the affected tests. Expected: PASS.
- [ ] **Step 5: Commit** `start the werkbank changelog with teil 2`.

### Task 20: End-to-end smoke

**Files:**
- Create: `e2e/werkbank-stammdaten.spec.ts`, `e2e/fixtures/werkbank-kunden.csv`

- [ ] **Step 1: Write the spec,** modelled on `e2e/werkbank-foundation.spec.ts` (German locale, its login helper, the admin created with the service-role client). Flow:
  1. Create the HV "Hausverwaltung Müller"; the new row shows a customer number starting with `K-`.
  2. Open the customer and add the property "WEG Musterstr. 5" with the billing recipient "WEG Musterstr. 5".
  3. The property detail shows "vertreten durch Hausverwaltung Müller".
  4. Add the contact "Hausmeister Schulz" as primary.
  5. On Leistungen, create "Stundensatz Monteur", unit Std, labour 58, material 0, VAT 19.
  6. The row shows "58,00 €".
  7. Import `werkbank-kunden.csv` (3 rows, one with an invalid postal code). The summary reads "2 importiert" and lists 1 error; the list shows both new customers.

  DB oracle via `adminClient().schema("werkbank")` for the counts. Cleanup: delete the org in `afterAll`.
- [ ] **Step 2: Run** `npm run test:e2e -- e2e/werkbank-stammdaten.spec.ts` against a running local stack. Expected: PASS.
- [ ] **Step 3: Run** `npm run verify:full`. Expected: all layers PASS.
- [ ] **Step 4: Commit** `add werkbank master data e2e smoke`.
