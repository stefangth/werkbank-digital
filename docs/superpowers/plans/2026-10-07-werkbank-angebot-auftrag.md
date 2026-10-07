# Werkbank Teil 3: Quotes and orders. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Office users write, send and version quotes, customers accept them online with a signature, and the office runs orders (from a quote or direct) with optional date and technicians.

**Architecture:** Schema `werkbank` gains quote and order header tables, one shared line-item table, an acceptance audit table and a company profile; VAT and discount totals live in one SQL view. One edge function `werkbank-quotes` renders the PDF (react-pdf, edge only), sends it, and serves the public token page's `view`/`decide`. The UI lives in `src/features/werkbank`, reusing Teil 2 patterns and a few existing pieces moved to kind-neutral core paths.

**Tech Stack:** Postgres/pgTAP, Supabase Storage + Edge Functions (Deno), `@react-pdf/renderer`, React 18 + React Query + react-hook-form + zod, cmdk, framer-motion `Reorder`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-werkbank-angebot-auftrag-design.md` (read it with this plan; requirement ids R1 to R12 refer to it).

## Global Constraints

- CLAUDE.md "Reuse before you build": use the pieces in the spec's Reuse map; no local copies of existing components or helpers.
- Isolation: Werkbank code only in `src/features/werkbank/**`, `supabase/functions/werkbank-*/**`, `supabase/functions/_shared/werkbank/**`, `supabase/migrations/*_werkbank_*.sql`, `supabase/tests/werkbank/**`, `e2e/werkbank-*.spec.ts`. Every other file that names `werkbank`/`handwerk` gets a named entry in `scripts/moduleIsolation.test.ts` (and an ESLint negation in `eslint.config.js` if it imports from the plugin).
- Every `werkbank` table: RLS on, explicit grants, FKs to `public.organizations` `on delete cascade`. Every `werkbank` function: `revoke all ... from public, anon`, explicit `grant execute`, SECURITY DEFINER bodies check the org role (`supabase/tests/werkbank/isolation.test.sql` enforces this).
- Migrations: new files named `<timestamp>_werkbank_<topic>.sql`, timestamps after `20261007170000`; never edit existing migrations; never apply to production by hand.
- UI: `docs/ui-conventions.md`; no raw values; numbers are `<Metric>`, quote and order numbers are `<Token>`; status colours from `TONES`; app copy in the `werkbank` namespace, EN and DE key parity, German Du-form, no em/en dashes, no exclamation marks.
- Customer-facing copy (public page, customer emails, PDF) is German and uses "Sie".
- Data layer: `fn(client, orgId, ...)` with `client.schema("werkbank")`, lists through `fetchAllPages`; query keys `["werkbank", <entity>, orgId, ...]`; mutations toast `t(mapDbError(e))` and invalidate `["werkbank", <entity>]`.
- Edge: `export async function handle(req, deps)`, `_shared/http.ts`, `_shared/auth.ts`; tests with `makeFakeDeps`.
- Numbers: quote prefix `A-`, order prefix `AU-`, padding 4; version suffix `-<n>` from version 2.
- Statuses: quotes `draft|sent|accepted|rejected|superseded` (expired derived: `sent` and `valid_until < berlin today`); orders `open|in_progress|done|cancelled`.
- Signed URLs: 600 seconds. Token: 32 random bytes, hex in the link, SHA-256 hex stored.
- Commit messages: imperative, lowercase, at most 72 chars, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- After each task: `npx vitest run <touched dirs>`, `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`; for SQL tasks `supabase test db` on the local stack; for edge tasks `deno test --allow-all supabase/functions/werkbank-quotes/` and `deno check --node-modules-dir=none` on touched functions. Before each PR: `npm run verify:fast` and `npm run sync:mirrors:check`.

## Review Focus

1. **Private customer without a property:** the PDF, the public page and the order fall back to the customer address as job location and recipient (spec R1 note from Teil 2). Test in Task 13 (PDF data builder) and Task 6 (`create_order_from_quote` copies a null property).
2. **Cent rounding across VAT groups with a discount:** e.g. three lines `0.335 × 1` at 19 %, one line at 7 %, discount 3 %: totals must be the per-group rounded values, never a re-rounded grand total. Test in Task 7 with exact numbers.
3. **The quote changes state while the customer has the page open** (superseded, link revoked, expired at midnight): `decide` answers 410 with the state and the page swaps to that state without losing the typed name silently. Tests in Task 15 (edge) and Task 17 (page).
4. **Double accept (double click, two tabs, retry after a network error):** exactly one acceptance row, one notification set, one confirmation email; the second call gets `decided`. Test in Task 15.
5. **Save race on a draft that was just sent by a colleague:** the item save fails on the lock, the page refetches and turns read-only with the lock message, no partial write. Test in Task 6 (trigger) and Task 12 (page reaction).

---

## PR 1: Foundation (branch `feature/werkbank-teil3-foundation`)

### Task 1: Move the embedded PDF fonts to a neutral mirror pair

**Files:**
- Move: `src/lib/hireOrders/pdf/fonts.ts` → `src/lib/pdf/fonts.ts`; `src/lib/hireOrders/pdf/fontInflate.ts` → `src/lib/pdf/fontInflate.ts`; `src/lib/hireOrders/pdf/fontInflate.test.ts` → `src/lib/pdf/fontInflate.test.ts`
- Modify: `scripts/mirrors.manifest.json` (targets → `supabase/functions/_shared/pdf/fonts.ts`, `.../_shared/pdf/fontInflate.ts`), `src/lib/hireOrders/pdf/pdfDeps.ts`, `supabase/functions/_shared/hire-order-pdf/pdfDeps.ts`, `scripts/compress-fonts.mjs`, any other importer found by `grep -rn "pdf/fonts\|fontInflate" src supabase scripts`
- Delete: the old generated targets under `_shared/hire-order-pdf/`

**Interfaces:**
- Produces: `GEIST_REGULAR_GZ_B64`, `GEIST_MEDIUM_GZ_B64`, `GEIST_SEMIBOLD_GZ_B64`, `GEIST_MONO_REGULAR_GZ_B64` from `_shared/pdf/fonts.ts`; `inflateFontGzB64(b64: string): Uint8Array`-shaped export (unchanged signature) from `_shared/pdf/fontInflate.ts`.

- [ ] **Step 1:** `git mv` the three files; retarget the manifest; run `npm run sync:mirrors`.
- [ ] **Step 2:** Update imports. Run `npx vitest run src/lib/pdf src/lib/hireOrders`, `deno test --allow-all supabase/functions/_shared/hire-order-pdf/`, `npm run sync:mirrors:check`. Expected: all PASS, no drift.
- [ ] **Step 3:** Commit `move embedded pdf fonts to a neutral mirror pair`.

### Task 2: Move SignaturePad to a kind-neutral path

**Files:**
- Move: `src/components/hireOrders/SignaturePad.tsx` → `src/components/common/SignaturePad.tsx` (+ its test)
- Modify: `src/components/hireOrders/SignHireOrderDialog.tsx` (+ test import path), `src/i18n/locales/{en,de}/hireOrdersPages.json` (remove `signaturePad`), `src/i18n/locales/{en,de}/common.json` (add `signaturePad.{type,draw,legalName,clear}` with the same values)

**Interfaces:**
- Produces: `SignaturePad({ value, onChange, disabled })` and `type SignatureValue = { method: "typed"; typedName: string } | { method: "drawn"; pngDataUrl: string }` from `@/components/common/SignaturePad`, using `useTranslation("common")`.

- [ ] **Step 1:** Move files; switch the namespace to `common`; update the test's expectations only where the namespace shows.
- [ ] **Step 2:** Run `npx vitest run src/components/common src/components/hireOrders src/i18n`. Expected: PASS (key parity included).
- [ ] **Step 3:** Commit `move signature pad to a kind-neutral component`.

### Task 3: Optional Reply-To on transactional email

**Files:**
- Modify: `supabase/functions/_shared/deps.ts` (`EmailMessage`), `supabase/functions/send-transactional-email/index.ts` (body parse + Resend request)
- Test: `supabase/functions/send-transactional-email/index.replyto.test.ts`

**Interfaces:**
- Produces: `EmailMessage.reply_to?: string`; Resend request gets `reply_to` only when present (requests without it stay byte-identical).

- [ ] **Step 1: Failing test** `index.replyto.test.ts`: a request with `reply_to: "office@example.com"` produces a Resend call whose JSON body has `reply_to === "office@example.com"`; a request without it has no `reply_to` key; an invalid address (no `@`) returns 400 `{ error: "invalid reply_to" }`. Model the setup on `index.attachments.test.ts`.
- [ ] **Step 2:** Run `deno test --allow-all supabase/functions/send-transactional-email/`. Expected: new test FAILS.
- [ ] **Step 3:** Implement: validate with the same email regex the function already uses for recipients; spread `...(replyTo ? { reply_to: replyTo } : {})` next to the attachments spread.
- [ ] **Step 4:** Rerun. Expected: all PASS.
- [ ] **Step 5:** Commit `add optional reply-to to transactional email`.

### Task 4: Public module routes

**Files:**
- Modify: `src/modules/ui.ts` (`ModuleUi.publicRoutes`), `src/App.tsx` (render them next to `ROUTES.SANDBOX`, wrapped in `SuspendedPage`, no `ProtectedRoute`, no `AppLayout`), `src/features/werkbank/ui.ts` (`publicRoutes: []` for now)
- Test: `src/modules/publicRoutes.test.tsx`

**Interfaces:**
- Produces: `interface ModulePublicRoute { path: string; Page: ComponentType }`; `ModuleUi.publicRoutes: ModulePublicRoute[]`.

- [ ] **Step 1: Failing test:** with `vi.mock("@/modules/ui", ...)` returning one module whose `publicRoutes` has `{ path: "/x/:token", Page: () => <p>public ok</p> }`, render `<App />` at `/x/abc` with no session (use `renderWithProviders`' unauthenticated setup); expect "public ok" and no redirect to `/login`.
- [ ] **Step 2:** Run `npx vitest run src/modules`. Expected: FAIL.
- [ ] **Step 3:** Implement the type and the `MODULE_UIS.flatMap((m) => m.publicRoutes)` route block.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `let modules register public routes`.

### Task 5: Tables, checks, RLS (R1)

**Files:**
- Create: `supabase/migrations/20261008100000_werkbank_quotes_orders.sql`
- Test: `supabase/tests/werkbank/quotes_orders.test.sql`

**Interfaces:**
- Produces: tables `werkbank.company_profiles`, `quotes`, `orders`, `order_technicians`, `document_items`, `quote_acceptances` with the columns, checks and FKs of spec R1 verbatim; unique `(org_id, id)` on quotes, orders, document_items for composite FKs; triggers `werkbank.check_property_customer()` (on quotes and orders: `property_id` null or belongs to `customer_id`, else raise `23514` with message `property_customer_mismatch`) and `werkbank.check_artist_org()` (on order_technicians, raise `23514` `artist_org_mismatch`).
- RLS: select/insert/update for admin or producer on quotes, orders, order_technicians, document_items; delete for admin or producer on draft quotes and on orders in `open`, on items always (the lock trigger of Task 6 decides); company_profiles select admin or producer, insert/update admin only; quote_acceptances select admin or producer, no write grant to `authenticated`.

- [ ] **Step 1: Failing pgTAP** `quotes_orders.test.sql` (pattern of `master_data.test.sql`): `has_table` for all six; RLS enabled on each; producer of org A inserts a quote and an item and reads them; technician of org A and admin of org B see 0 rows; producer cannot update `company_profiles`, admin can; `authenticated` cannot insert into `quote_acceptances`; `document_items` with both parents or none fails `23514`; an `item` row without unit fails; a `title` row with a price fails; `line_net` of `quantity 2.5, labour 10.10, material 3.333→3.33` equals `33.58`; quote with a property of another customer fails with `property_customer_mismatch`; order technician from another org fails with `artist_org_mismatch`; `scheduled_time` without date fails.
- [ ] **Step 2:** Run `supabase test db`. Expected: FAIL (tables missing).
- [ ] **Step 3:** Write the migration (grant insert, update, delete explicitly per table next to its policies; default privileges from Teil 1 make tables select-only otherwise).
- [ ] **Step 4:** `npm run local:reset` then `supabase test db`. Expected: PASS, including `isolation.test.sql`.
- [ ] **Step 5:** Commit `add werkbank quote, order and line item tables`.

### Task 6: Locks, numbers and RPCs (R2)

**Files:**
- Create: `supabase/migrations/20261008110000_werkbank_quote_order_logic.sql`
- Test: `supabase/tests/werkbank/quote_order_logic.test.sql`

**Interfaces:**
- Produces: triggers `werkbank.lock_quote()` (on quotes and on document_items with `quote_id`), `werkbank.order_transition()` (on orders and on document_items with `order_id`), `werkbank.assign_quote_no()`, `werkbank.assign_order_no()`; ranges `quote` (`A-`, padding 4) and `order` (`AU-`, padding 4) seeded wherever `customer` is seeded (extend that seeding branch); RPCs
  - `werkbank.revise_quote(p_quote uuid) returns uuid`
  - `werkbank.copy_quote(p_quote uuid, p_customer uuid default null, p_property uuid default null) returns uuid`
  - `werkbank.create_order_from_quote(p_quote uuid) returns uuid`
  - all `security definer`, `set search_path = ''`, raising `42501` unless the caller is admin or producer of the quote's org; execute granted to `authenticated` only.
- Lock errors raise `55000` with message `quote_locked` / `order_locked`; illegal transitions raise `22023` `invalid_transition`.

- [ ] **Step 1: Failing pgTAP**:
  - new quote gets `A-0001`, next `A-0002`; new order `AU-0001`; numbers skip taken values like `assign_customer_no`.
  - as producer: updating `subject` of a `sent` quote fails `quote_locked`; inserting an item into it fails; setting `valid_until` and `link_revoked_at` on it succeeds; setting `status` to `accepted` as producer fails (service role only).
  - `revise_quote` on a `sent` quote returns a new id with the same `quote_no`, `version = 2`, `status = 'draft'`, the same item count; the old row is `superseded` with `superseded_by` set and `link_revoked_at` not null. On a `draft` it raises `invalid_transition`.
  - `copy_quote` returns version 1 with a new number and copies items; with `p_customer` set it switches customer and clears a mismatching property.
  - `create_order_from_quote` on `accepted` copies header and items with `source_item_id` pointing at the quote items; a second call fails `23505`; on `sent` it raises `invalid_transition`; a quote with null property yields an order with null property.
  - order: `open → in_progress → done` sets `completed_at`; editing an item in `done` fails `order_locked`; `done → in_progress` clears nothing but allows edits; `done → cancelled` fails `invalid_transition`; `cancelled` sets `cancelled_at`.
  - technician of the org and admin of another org get `42501` from all three RPCs.
- [ ] **Step 2:** Run `supabase test db`. Expected: FAIL.
- [ ] **Step 3:** Write the migration. The service role is detected with `auth.role() = 'service_role'` (as elsewhere in the repo; grep for the existing helper before writing a new one).
- [ ] **Step 4:** Reset and rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add quote and order locks, numbering and rpcs`.

### Task 7: Totals views and storage (R3, R4)

**Files:**
- Create: `supabase/migrations/20261008120000_werkbank_totals_storage.sql`
- Test: `supabase/tests/werkbank/totals_storage.test.sql`

**Interfaces:**
- Produces: views (all `with (security_invoker = true)`, select granted to `authenticated`)
  - `werkbank.document_totals(quote_id uuid, order_id uuid, net_total numeric, discount_total numeric, vat_total numeric, gross_total numeric, labour_total numeric, vat_breakdown jsonb)`; `vat_breakdown` = `[{ rate, net, discounted_net, vat }]` ordered by rate desc. Documents without items appear with zeros.
  - `werkbank.quote_list`: quote columns + `customer_name`, `property_name`, totals, `is_expired boolean` (`status = 'sent' and valid_until < (now() at time zone 'Europe/Berlin')::date`), `has_order boolean`.
  - `werkbank.order_list`: order columns + names, totals, `technician_ids uuid[]`, `technician_names text[]`.
- Buckets `werkbank-assets` and `werkbank-documents` (private) with policies per spec R4.

- [ ] **Step 1: Failing pgTAP** with exact values:
  - lines 19 %: `1 × 0.335` three times (`line_net` 0.34 each → 1.02), 7 %: `1 × 10.00`; discount 3 %: 19 % group discounted net `0.99`, vat `0.19`; 7 % group discounted net `9.70`, vat `0.68`; `net_total 11.02`, `discount_total 0.33`, `vat_total 0.87`, `gross_total 11.56`.
  - discount 100 %: all totals 0.
  - a quote with only a title row: totals 0, one row in the view.
  - `labour_total` with labour 60 + material 40 at qty 1, discount 10 %: `54.00`.
  - `quote_list.is_expired` true for `sent` with `valid_until = yesterday`, false for `draft` with the same date.
  - storage: admin of org A can insert `werkbank-assets/<A>/logo.png`; producer cannot; nobody `authenticated` can insert into `werkbank-documents`; producer of A can select `werkbank-documents/<A>/x.pdf`, admin of B cannot.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Write the migration (the view computes per rate in a CTE, then aggregates; round per spec R3).
- [ ] **Step 4:** Reset and rerun. Expected: PASS.
- [ ] **Step 5:** Regenerate types `supabase gen types typescript --local --schema public,graphql_public,werkbank > src/integrations/supabase/types.ts`, `npm run sync:mirrors`, `npx tsc -p tsconfig.app.json --noEmit`.
- [ ] **Step 6:** Add the six tables to the Werkbank list in `supabase/functions/export-org-data/index.ts` (R12) with a failing-then-passing assertion in its existing Deno test that `werkbank.quotes` rows of the org are exported and other orgs' are not.
- [ ] **Step 7:** Commit `add werkbank totals views, storage buckets and export`.

### Task 8: Company profile tab (R8 part 1)

**Files:**
- Create: `src/features/werkbank/data/companyProfile.ts`, `hooks/useCompanyProfile.ts`, `schemas/companyProfile.ts`, `components/CompanyTab.tsx`, `components/LogoUpload.tsx` (+ tests beside each)
- Modify: `src/lib/settingsTabs.ts` (`company` param, `SETTINGS_TAB_KINDS.company = ["handwerk"]`, admin only), `src/pages/SettingsPage.tsx` (mount `CompanyTab`), `eslint.config.js` (negation for `components/CompanyTab`), `scripts/moduleIsolation.test.ts` (no new file if SettingsPage is already listed; check), `src/features/werkbank/i18n/{en,de}.json` (`company.*`)

**Interfaces:**
- Produces:
  - `type CompanyProfile = Database["werkbank"]["Tables"]["company_profiles"]["Row"]`
  - `fetchCompanyProfile(client, orgId): Promise<CompanyProfile | null>`; `saveCompanyProfile(client, orgId, row: CompanyProfileForm): Promise<void>` (upsert on `org_id`); `uploadLogo(client, orgId, file: File): Promise<string>` (path `<orgId>/logo-<timestamp>.<ext>`, returns the path); `logoUrl(client, path): Promise<string>` (signed, 600 s)
  - `useCompanyProfile()`, `useSaveCompanyProfile()` with key `["werkbank", "company-profile", orgId]`
  - `companyProfileSchema(t)` mirroring the R1 checks; `isCompanyProfileComplete(p: CompanyProfile | null): boolean` (name, address, email, and either `tax_number` or `vat_id`)

- [ ] **Step 1: Failing tests:** schema (`iban` with spaces is normalised, bad VAT id rejected, validity 0 rejected); `isCompanyProfileComplete` true/false cases; data layer with `supabaseFake` (upsert payload, storage upload path prefix is the org id); `CompanyTab` renders for admin, is absent for producer and for non-handwerk orgs; `LogoUpload` rejects a 2 MB file and a GIF with `company.logo.tooLarge` / `company.logo.wrongType`.
- [ ] **Step 2:** Run `npx vitest run src/features/werkbank src/lib/settingsTabs*`. Expected: FAIL.
- [ ] **Step 3:** Implement with the CustomerFormDialog form patterns; uploads use `client.storage.from("werkbank-assets").upload(path, file, { upsert: true })`.
- [ ] **Step 4:** Rerun plus `npx vitest run scripts/moduleIsolation.test.ts src/i18n`. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank company profile settings`.

### Task 9: Number ranges for quotes and orders (R8 part 2)

**Files:**
- Modify: `src/features/werkbank/data/numberRanges.ts` (`NumberRangeKey = "customer" | "quote" | "order"`, defaults `A-`/`AU-` padding 4), `components/NumberingTab.tsx` (one row per key), i18n `numbering.*`
- Test: `data/numberRanges.test.ts`, `components/NumberingTab.test.tsx`

- [ ] **Step 1: Failing tests:** `formatNumber("A-", 42, 4) === "A-0042"`; the tab shows three rows with previews `K-…`, `A-0001`, `AU-0001` for empty ranges; saving the quote row calls `saveNumberRange(client, orgId, "quote", …)`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS. Then `npm run verify:fast`.
- [ ] **Step 5:** Commit `add quote and order number ranges to settings`. Open PR 1.

---

## PR 2: Quotes end to end (branch `feature/werkbank-teil3-quotes`, from main after PR 1)

### Task 10: Quote and line-item data layer

**Files:**
- Create: `src/features/werkbank/data/quotes.ts`, `data/documentItems.ts`, `hooks/useQuotes.ts`, `hooks/useDocumentItems.ts`, `lib/quoteNumber.ts` (+ tests)
- Modify: `lib/dbErrors.ts` (+ test)

**Interfaces:**
- Produces:
  - `type DocumentRef = { quoteId: string } | { orderId: string }`
  - `type DocumentItem = Database["werkbank"]["Tables"]["document_items"]["Row"]`, `type ItemDraft = Pick<DocumentItem, "kind" | "name" | "description" | "catalog_item_id" | "item_no" | "quantity" | "unit_code" | "labour_price" | "material_price" | "vat_rate">`
  - `fetchQuoteList(client, orgId)`, `fetchQuote(client, id)` (row + totals), `createQuote(client, orgId, draft): Promise<string>`, `updateQuote(client, id, patch)`, `deleteQuote(client, id)`, `extendQuote(client, id, validUntil: string)`, `revokeQuoteLink(client, id)`, `reviseQuote(client, id): Promise<string>`, `copyQuote(client, id, opts?): Promise<string>`
  - `fetchItems(client, ref)`, `addItem(client, orgId, ref, draft, sortOrder)`, `updateItem(client, id, patch)`, `deleteItem(client, id)`, `reorderItems(client, ref, ids: string[])` (writes `sort_order = index * 10`)
  - `formatQuoteNumber(quoteNo: string, version: number): string` (`"A-0042"`, `"A-0042-2"`)
  - `sectionSubtotals(items: DocumentItem[]): Map<string, number>` (title id → sum of `line_net` until the next title)
  - hooks `useQuoteList`, `useQuote(id)`, `useQuoteMutations()`, `useDocumentItems(ref)`, `useItemMutations(ref)`; keys `["werkbank","quotes",orgId]`, `["werkbank","quotes","detail",id]`, `["werkbank","items",refKey]`; item mutations also invalidate the parent detail (totals)
  - `mapDbError` maps `quote_locked`, `order_locked`, `property_customer_mismatch`, `invalid_transition` and `23505` on `orders_quote_id_key` to `errors.quoteLocked`, `errors.orderLocked`, `errors.propertyMismatch`, `errors.invalidTransition`, `errors.orderExists`

- [ ] **Step 1: Failing tests** (`supabaseFake`): list reads `quote_list` via `fetchAllPages`; `createQuote` prefills intro/closing/payment terms and `valid_until = today + quote_validity_days` from the profile (pass the profile in); `reorderItems` writes 0, 10, 20; `reviseQuote` calls `rpc("revise_quote", { p_quote })` on the `werkbank` schema; `formatQuoteNumber` cases; `sectionSubtotals` for title, two items, text, title, one item; each new `mapDbError` case.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank quote and line item data layer`.

### Task 11: Pickers and the line-item editor

**Files:**
- Create: `components/PropertyPicker.tsx`, `components/ContactSelect.tsx`, `components/CatalogItemCombobox.tsx`, `components/LineItemsEditor.tsx`, `components/DocumentTotalsCard.tsx` (+ tests)

**Interfaces:**
- Consumes: Task 10 item hooks, `useCatalogItems`, `usePropertiesForCustomer`, `useContacts`, `units.ts`, `formatEuro`.
- Produces:
  - `PropertyPicker({ customerId, value, onChange, disabled })` (built like `CustomerPicker`; empty and disabled without a customer)
  - `ContactSelect({ customerId, propertyId, value, onChange })` (contacts of property first, then customer)
  - `CatalogItemCombobox({ onPick: (item: CatalogItem) => void })` (search over `item_no`, `name`, `category`; active items only)
  - `LineItemsEditor({ docRef: DocumentRef, readOnly: boolean })`: add catalog item (snapshot of name, item_no, unit, prices, vat), add free item, title, text; inline inputs for quantity and prices saved per row after 500 ms debounce; `Reorder.Group` with a grip handle, persisting on drag end via `reorderItems`; delete with confirmation only for titles that have items; shows `sectionSubtotals` on title rows; `readOnly` renders plain text
  - `DocumentTotalsCard({ totals, isPrivateCustomer })`: net, discount (hidden at 0), one VAT row per rate, gross, and "davon Lohnanteil (§35a EStG)" when private

- [ ] **Step 1: Failing tests:** picking a catalog item calls `addItem` with the snapshot values; typing a quantity calls `updateItem` once after the debounce; reorder persists the new order; `readOnly` shows no inputs and no grip; subtotal on a title row equals the sum of its items; the totals card hides the §35a line for property managers; `PropertyPicker` disabled without customer.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement. Money inputs reuse `PRICE`/`toNumber` from `schemas/catalogItem.ts`.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank line item editor and pickers`.

### Task 12: Quotes list and quote page (no sending yet)

**Files:**
- Create: `pages/QuotesPage.tsx`, `pages/QuotePage.tsx`, `components/QuoteHeaderForm.tsx`, `components/QuoteHistory.tsx`, `src/lib/minis/pages/quotes.ts`, `src/components/minis/illustrations/QuotesMini.tsx` (+ tests)
- Modify: `paths.ts` (`QUOTES_PATH = "/quotes"`, `quotePath(id)`), `ui.ts` (nav item "Angebote", icon `FileText`, routes), `src/lib/minis/index.ts`, `src/lib/minis/types.ts`, `src/components/minis/illustrations/index.ts`, `scripts/moduleIsolation.test.ts` if the minis files need entries, i18n `quotes.*`, `nav.quotes`

**Interfaces:**
- Consumes: Tasks 10 and 11, `useCompanyProfile`.
- Produces: `QuotesPage`, `QuotePage`; `quoteDisplayStatus(q: { status; is_expired }): "draft" | "sent" | "accepted" | "rejected" | "expired" | "superseded"` in `lib/quoteStatus.ts` with a `TONES` mapping (`draft` neutral, `sent` waiting, `accepted` confirmed, `rejected` risk, `expired` risk, `superseded` neutral).

- [ ] **Step 1: Failing tests:** list filters by display status including expired; search matches number, customer, subject; notice "Angenommen, noch kein Auftrag" counts `accepted && !has_order`; "Angebot anlegen" creates a draft and navigates to it; the page in `draft` shows editable header and editor; in `sent` it is read-only and shows Überarbeiten, Kopieren, Verlängern, Link sperren; Überarbeiten navigates to the new id; a save that rejects with `quote_locked` refetches and shows `errors.quoteLocked` (Review Focus 5); the history lists sent and decision entries with the signature image; versions link to each other; nav item visible for admin and producer of handwerk only; mini copy passes `minis.test.ts`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement with the `CustomersPage` / `CustomerDetailPage` patterns.
- [ ] **Step 4:** Rerun plus `npx vitest run src/lib/minis src/i18n scripts`. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank quotes list and quote page`.

### Task 13: Quote PDF document

**Files:**
- Create: `supabase/functions/_shared/werkbank/pdf/fonts.ts`, `_shared/werkbank/pdf/quoteData.ts`, `_shared/werkbank/pdf/quoteDocument.tsx`, `supabase/functions/werkbank-quotes/deno.json` (copy of `generate-hire-orders/deno.json`) (+ tests)

**Interfaces:**
- Consumes: `_shared/pdf/fonts.ts`, `_shared/pdf/fontInflate.ts` (Task 1).
- Produces:
  - `registerQuoteFonts(): void` (registers Geist once via `Font.register` with `data:` URLs from the inflated bytes)
  - `type QuotePdfData = { seller: {...profile fields, logoDataUrl?: string}; recipient: { lines: string[] }; location: string[]; number: string; date: string; validUntil: string; subject; intro; closing; paymentTerms; sections: Array<{ title?: string; number?: string; rows: Array<{ number?: string; kind: "item" | "text"; name?; description?; quantity?; unit?; unitPrice?; lineNet? }>; subtotal?: number }>; totals: { net; discount; discountPercent; vat: Array<{ rate; net; vat }>; gross; labour?: number }; watermark?: "Entwurf"; acceptance?: { name; decidedAt; signaturePngDataUrl?; typedName? } }`
  - `buildQuotePdfData(input: { quote; items; totals; customer; property; profile; logoDataUrl?; acceptance? }): QuotePdfData` (pure: recipient = property billing recipient with "vertreten durch <customer>" when set, else customer; location = property address, else customer address; numbering 1, 1.1)
  - `renderQuotePdf(data: QuotePdfData): Promise<Uint8Array>`

- [ ] **Step 1: Failing tests** (`deno test`): `buildQuotePdfData` for a private customer without property uses the customer address for recipient and location (Review Focus 1); a property with billing recipient prints "vertreten durch"; sections number `1`, `1.1`, `1.2`, `2`, `2.1`; text rows have no number; `renderQuotePdf` on a sample returns bytes starting with `%PDF` and, with 120 items, more than one page (`/Type /Page` count > 1); the watermark text appears in the bytes when set.
- [ ] **Step 2:** Run `deno test --allow-all supabase/functions/_shared/werkbank/pdf/`. Expected: FAIL.
- [ ] **Step 3:** Implement the layout of spec R6 with `npm:@react-pdf/renderer@^4`; all PDF copy German, no dashes.
- [ ] **Step 4:** Rerun plus `deno check --node-modules-dir=none` on the files. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank quote pdf document`.

### Task 14: `werkbank-quotes` internal actions and emails

**Files:**
- Create: `supabase/functions/werkbank-quotes/index.ts`, `index.internal.test.ts`, `_shared/werkbank/quotePreflight.ts` (+ test), `_shared/werkbank/emails/quote-sent.tsx`, `quote-decided.tsx`, `quote-decision-confirmation.tsx`
- Modify: `supabase/config.toml` (`[functions.werkbank-quotes] verify_jwt = false`), `_shared/transactional-email-templates/registry.ts` (`TEMPLATES`, `SUBJECT_RESOLVERS`), `src/lib/emailTemplates/emailCopy.ts` (`EMAIL_TEMPLATE_KEYS` + defaults; then `npm run sync:mirrors`), `_shared/notificationCategories.ts` (`EMAIL_TEMPLATE_CATEGORY`: transactional), `scripts/moduleIsolation.test.ts` (entries for `registry.ts` and `emailCopy.ts` and their mirrors)

**Interfaces:**
- Consumes: Task 13, Task 3 `reply_to`, `requireOrgRole`, `resolveOrgKind`, `appUrl`.
- Produces:
  - `quotePreflight(input: { profile; itemCount: number; recipients: string[]; validUntil: string; today: string }): Array<"profile_incomplete" | "no_items" | "no_recipient" | "valid_until_past">` (shared with the UI through the mirror manifest: add `supabase/functions/_shared/werkbank/quotePreflight.ts` as target of source `src/features/werkbank/lib/quotePreflight.ts`; write the source there)
  - `export async function handle(req: Request, deps: Deps, render = renderQuotePdf): Promise<Response>`
  - actions: `preview { org_id, quote_id } → { pdf_base64 }`; `send { org_id, quote_id, to: string[], cc: string[], message: string } → { ok: true, email_sent: boolean }`; `resend` (same body) `→ { ok: true, email_sent: boolean }`; `download-url { org_id, quote_id, kind: "sent" | "accepted" } → { url }`
  - error codes: `forbidden` 403, `not_handwerk` 403, `not_found` 404, `preflight_failed` 422 with `{ blockers }`, `invalid_state` 409

- [ ] **Step 1: Failing tests** (`makeFakeDeps`): producer of another org gets 403; a non-handwerk org gets `not_handwerk`; `preview` returns base64 and writes nothing (no storage, no update calls); `send` with no items returns 422 `["no_items"]`; successful `send` records in order: storage upload to `werkbank-documents/<org>/quotes/<id>.pdf`, one update setting `status`, `sent_at`, `sent_to`, `pdf_path`, `pdf_sha256` (64 hex chars, equal to the SHA-256 of the rendered bytes) and `access_token_hash`, then `sendEmail` with template `quote-sent`, `reply_to` = profile email, one attachment, and `templateData.link` = `<app>/quote/<token>` whose SHA-256 equals the stored hash; email failure returns `email_sent: false` and the quote stays `sent`; `resend` on `sent` stores a different token hash and keeps `pdf_path`; `resend` on `draft` is 409; `download-url` returns a signed URL with 600 s expiry.
- [ ] **Step 2:** Run `deno test --allow-all supabase/functions/werkbank-quotes/`. Expected: FAIL.
- [ ] **Step 3:** Implement; SHA-256 via `crypto.subtle.digest`; token via `crypto.getRandomValues(new Uint8Array(32))`; the three templates follow `hire-order-issued.tsx` (Sie-form to customers, Du-form to the office).
- [ ] **Step 4:** Rerun plus `deno check --node-modules-dir=none supabase/functions/werkbank-quotes/index.ts`, `npx vitest run scripts src/lib/emailTemplates`, `npm run sync:mirrors:check`. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank-quotes preview, send and download actions`.

### Task 15: `werkbank-quotes` public actions and notifications

**Files:**
- Modify: `supabase/functions/werkbank-quotes/index.ts`
- Create: `supabase/functions/werkbank-quotes/index.public.test.ts`, `_shared/werkbank/acceptance.ts` (+ test)
- Modify: `src/lib/notifications/entityRoutes.ts` (`werkbank_quote` → `/quotes/:id`, + test), `scripts/moduleIsolation.test.ts`

**Interfaces:**
- Produces:
  - `parseSignature(input: unknown): { method: "typed"; typedName: string } | { method: "drawn"; png: Uint8Array } | null` (PNG magic bytes, max 2 000 000 data-URL chars, typed name 2 to 120 chars)
  - `QUOTE_CONSENT_TEXT` (German, Sie-form, exact text decided in this task and shown verbatim on the public page via the `view` response)
  - actions: `view { token } → 200 { quote, seller, items, totals, pdf_url, consent_text } | 404 { error: "not_found" } | 410 { error: "superseded" | "expired" | "revoked" | "decided", decision? }`; `decide { token, decision: "accepted" | "rejected", signer_name, signature?, comment?, consent: true } → 200 { ok: true } | 404 | 410 (same states) | 422 { error: "invalid_signature" | "consent_required" }`

- [ ] **Step 1: Failing tests:** unknown token 404; superseded, revoked, expired (valid_until yesterday Berlin) and decided quotes each give their 410 state from both `view` and `decide` (Review Focus 3); `view` exposes no customer email or phone and a `pdf_url` with 600 s expiry; `decide` accepted without signature 422 `invalid_signature`, without consent 422; a valid accept inserts one `quote_acceptances` row with `document_sha256 = pdf_sha256`, the first `x-forwarded-for` entry as IP and the user agent, uploads the signature PNG, renders and stores `accepted_pdf_path`, sets `accepted`, inserts one `quote_accepted` notification per admin and producer membership of the org with `related_entity_type = "werkbank_quote"`, sends `quote-decided` to them and `quote-decision-confirmation` with the accepted PDF to the quote's first `sent_to` address; a second `decide` (simulate the unique violation `23505`) returns 410 `decided` and sends nothing more (Review Focus 4); reject stores the comment and sends the confirmation without attachment.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement; the acceptance insert happens before the status update so the unique constraint is the gate; notification inserts follow `notifyProducersCountersigned`; side effects after the insert are wrapped and logged like the hire-order sign action.
- [ ] **Step 4:** Rerun plus `npx vitest run src/lib/notifications`. Expected: PASS.
- [ ] **Step 5:** Commit `add public quote view and decision actions`.

### Task 16: Send dialog and quote page actions

**Files:**
- Create: `components/SendQuoteDialog.tsx` (+ test), `data/quoteActions.ts` (+ test)
- Modify: `pages/QuotePage.tsx`

**Interfaces:**
- Produces: `previewQuote(client, orgId, quoteId): Promise<void>` (invokes `werkbank-quotes`, opens the PDF from base64 in a new tab), `sendQuote(client, orgId, quoteId, body): Promise<{ emailSent: boolean }>`, `resendQuote(...)`, `quoteDownloadUrl(client, orgId, quoteId, kind): Promise<string>`; `SendQuoteDialog({ quote, open, onOpenChange })`.

- [ ] **Step 1: Failing tests:** the dialog prefills the contact email, else the customer email; shows each preflight blocker from `quotePreflight` and disables Send while any exist; a successful send toasts `quotes.sent`, a send with `emailSent: false` shows `quotes.emailFailed` with a "Erneut senden" action; Vorschau calls `previewQuote`; Erneut senden on a sent quote opens the dialog in resend mode.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement; `client.functions.invoke("werkbank-quotes", { body })`.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank send quote dialog`.

### Task 17: Public quote page

**Files:**
- Create: `pages/QuotePublicPage.tsx`, `data/publicQuote.ts` (+ tests)
- Modify: `paths.ts` (`PUBLIC_QUOTE_PATH = "/quote/:token"`), `ui.ts` (`publicRoutes: [{ path: PUBLIC_QUOTE_PATH, Page: QuotePublicPage }]`), i18n `publicQuote.*` (German Sie-form copy in both locale files is acceptable only if copy lint allows; otherwise add the named exemption in `src/i18n/copyLint.test.ts`)

**Interfaces:**
- Consumes: Task 15 responses, `SignaturePad` (Task 2).
- Produces: `fetchPublicQuote(client, token)`, `decidePublicQuote(client, token, body)`; `QuotePublicPage`.

- [ ] **Step 1: Failing tests:** renders logo, sections, totals and a PDF link for an open quote; each 404/410 state shows its own message and no form; accept requires name, signature and consent before the button enables; a 410 `superseded` answer to `decide` swaps the page to the superseded state and keeps a visible note that nothing was signed (Review Focus 3); a successful accept shows the thank-you state with the accepted PDF link; reject sends the comment; the page renders without a session and without `AppLayout`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement, mobile first, modelled on `SandboxViewerPage`.
- [ ] **Step 4:** Rerun plus `npm run verify:fast`. Expected: PASS.
- [ ] **Step 5:** Commit `add public quote acceptance page`. Open PR 2.

---

## PR 3: Orders and the rest (branch `feature/werkbank-teil3-orders`, from main after PR 2)

### Task 18: Order data layer and technician select

**Files:**
- Create: `data/orders.ts`, `hooks/useOrders.ts`, `components/TechnicianMultiSelect.tsx`, `lib/orderStatus.ts` (+ tests)

**Interfaces:**
- Produces:
  - `fetchOrderList(client, orgId)`, `fetchOrder(client, id)`, `createOrder(client, orgId, draft): Promise<string>`, `updateOrder(client, id, patch)`, `setOrderStatus(client, id, status)`, `setOrderTechnicians(client, orgId, orderId, artistIds: string[])` (delete missing, insert new), `createOrderFromQuote(client, quoteId): Promise<string>`
  - hooks `useOrderList`, `useOrder(id)`, `useOrderMutations()`; keys `["werkbank","orders",orgId]`, `["werkbank","orders","detail",id]`; `createOrderFromQuote` also invalidates `["werkbank","quotes"]`
  - `ORDER_STATUS_TONES` (`open` waiting, `in_progress` accent, `done` confirmed, `cancelled` neutral); `nextOrderActions(status): Array<"start" | "complete" | "reopen" | "cancel">`
  - `TechnicianMultiSelect({ value: string[], onChange })` (cmdk with check marks, chips for selected, data from `useTechnicians`)

- [ ] **Step 1: Failing tests:** `setOrderTechnicians` from `[a,b]` to `[b,c]` deletes `a` and inserts `c` only; `createOrderFromQuote` calls `rpc("create_order_from_quote")`; `nextOrderActions` per status matches spec R2; the multi-select toggles and shows chips.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank order data layer and technician select`.

### Task 19: Orders list and order page

**Files:**
- Create: `pages/OrdersPage.tsx`, `pages/OrderPage.tsx`, `components/OrderScheduleCard.tsx`, `components/QuoteComparison.tsx`, `src/lib/minis/pages/orders.ts`, `src/components/minis/illustrations/OrdersMini.tsx` (+ tests)
- Modify: `paths.ts` (`ORDERS_PATH = "/orders"`, `orderPath(id)`), `ui.ts` (nav "Aufträge", icon `ClipboardList`), `pages/QuotePage.tsx` ("Auftrag anlegen" on accepted, link to the order when it exists), minis registry files, i18n `orders.*`

**Interfaces:**
- Consumes: Tasks 11 and 18.
- Produces: `diffAgainstQuote(orderItems: DocumentItem[], quoteItems: DocumentItem[]): { changed: Set<string>; added: Set<string>; removedCount: number }` in `lib/quoteDiff.ts` (changed = quantity or a price differs from the `source_item_id` line).

- [ ] **Step 1: Failing tests:** list filters by status, technician, date range and "Nicht eingeplant"; "Auftrag anlegen" creates a direct order; the order page saves date, time (time disabled without date) and technicians; editor is read-only in `done` and `cancelled`; status buttons follow `nextOrderActions`; the comparison line shows quote gross, order gross and the difference, marks changed and added rows; `diffAgainstQuote` unit cases; on the quote page "Auftrag anlegen" calls `createOrderFromQuote` and navigates.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun plus minis and i18n tests. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank orders list and order page`.

### Task 20: Customer and property sections, dashboard

**Files:**
- Create: `components/DocumentsSection.tsx` (+ test)
- Modify: `pages/CustomerDetailPage.tsx`, `pages/PropertyDetailPage.tsx`, `components/WerkbankDashboard.tsx`, `components/StartList.tsx`, `data/startList.ts` (+ their tests), i18n

**Interfaces:**
- Produces: `DocumentsSection({ customerId?: string; propertyId?: string })` (two short tables, quotes and orders, from `quote_list`/`order_list` filtered client-side, with create actions that preselect customer and property).

- [ ] **Step 1: Failing tests:** customer page lists only that customer's quotes and orders; property page only that property's; create from the property preselects both ids; dashboard shows `KpiTile`s "Angenommen, ohne Auftrag" and "Aufträge ohne Termin" with counts linking to the filtered lists (office roles only); the start list gains "Firmendaten ausfüllen", done when `isCompanyProfileComplete`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `show quotes and orders on customers, properties and dashboard`.

### Task 21: Help, changelog, system map, end-to-end

**Files:**
- Modify: `src/lib/help/items.ts` (W-items for quotes, versions, online acceptance, orders, scheduling, company data; EN and DE, Du, `kinds: ['handwerk']`), `public/changelog.md` + regenerated `public/changelog.json`, `docs/system-map.md` and `src/data/systemMap.ts` (the `werkbank-quotes` actions, the notification and the emails), `package.json`/`src/config/app.config.ts` version bump (MINOR)
- Create: `e2e/werkbank-angebot.spec.ts`

- [ ] **Step 1:** Add the help items and changelog block (`## X.Y.0 — Mon D, YYYY` per CLAUDE.md, user-facing bullets only); run `deno run --allow-read --allow-write scripts/changelog-to-json.ts`; run `npx vitest run src/lib/help src/i18n src/data`. Expected: PASS.
- [ ] **Step 2: Playwright** `werkbank-angebot.spec.ts` on the local stack: admin fills the company profile; creates a quote for a seeded customer with a title, a catalog item and a text line; sends it; reads the link from the captured email (the local stack's mail capture used by existing e2e specs); opens it in a fresh context; signs typed and accepts; back as admin sees the accepted status and the notification; creates the order; sets a date and a technician; sees the order in the list with that technician.
- [ ] **Step 3:** Run `npx playwright test --config=e2e/playwright.config.ts e2e/werkbank-angebot.spec.ts`. Expected: PASS. Then `npm run verify:full`.
- [ ] **Step 4:** Commit `add teil 3 help, changelog, system map and e2e`. Open PR 3.
