# Werkbank Teil 4: Invoices. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office turns a done order (or nothing) into a final invoice, issues it under GoBD rules with a gapless number, sends it as a ZUGFeRD EN 16931 PDF, and corrects it only by cancellation plus a corrected copy.

**Architecture:** Schema `werkbank` gains `invoices`; items stay in `document_items` (new `invoice_id` parent) and totals in `document_totals`. All state changes that GoBD cares about (number, snapshots, issue, cancel, order `invoiced`) happen in one SECURITY DEFINER RPC, `finalize_invoice`. A new edge function `werkbank-invoices` renders the PDF from the frozen data, embeds the Factur-X XML with `@e-invoice-eu/core`, stores the file once (immutable under a storage trigger) and sends it. UI in `src/features/werkbank` reuses the Teil 3 document components.

**Tech Stack:** Postgres/pgTAP, Supabase Storage + Edge Functions (Deno), `@react-pdf/renderer`, `@e-invoice-eu/core` 3.4.0, React 18 + React Query, Vitest, Playwright, Mustang CLI (CI only).

**Spec:** `docs/superpowers/specs/2026-10-08-werkbank-rechnung-design.md` (requirement ids R1 to R8 refer to it). Teil 3 spec and plan (`2026-10-07-werkbank-angebot-auftrag*`) describe the pieces reused here.

## Global Constraints

- CLAUDE.md "Reuse before you build": use the spec's Reuse map; no local copies of `LineItemsEditor`, `DocumentTotalsCard`, `DocumentHeaderFields`, pickers, `fetchAllPages`, `mapDbError`, `formatEuro`.
- Isolation: Werkbank code only in `src/features/werkbank/**`, `supabase/functions/werkbank-*/**`, `supabase/functions/_shared/werkbank/**`, `supabase/migrations/*_werkbank_*.sql`, `supabase/tests/werkbank/**`, `e2e/werkbank-*.spec.ts`, plus the existing allow-listed touch points in `scripts/moduleIsolation.test.ts`. Any new touch point gets a named allow-list entry with a reason.
- Every `werkbank` table: RLS on, explicit grants, FKs to `public.organizations` `on delete cascade`. Every `werkbank` function: `revoke all ... from public, anon`, explicit `grant execute`, SECURITY DEFINER bodies check the org role (`isolation.test.sql`).
- Owner detection in triggers as in Teil 3: `current_user not in ('authenticated', 'anon', 'service_role')` means a SECURITY DEFINER body or an FK action; `current_user = 'service_role'` means the edge function.
- Migrations: `<timestamp>_werkbank_<topic>.sql`, timestamps after `20261007220000` (use `20261008100000`, `...110000`, `...120000`); never edit existing migrations; never apply to production by hand.
- Number range `invoice`: prefix `RE-`, `next_value` 1, padding 4, seeded in `werkbank.next_number` next to `customer`, `quote`, `order`. Invoices and cancellations share it.
- Statuses: invoices `draft|issued|cancelled`, types `invoice|cancellation`; orders gain `invoiced`.
- Dates: `issue_date` and the default `service_date_from` are Berlin dates (`(now() at time zone 'Europe/Berlin')::date` in SQL, `berlinDateKey` in TS); `due_date = issue_date + payment_due_days`.
- Error messages raised by SQL (map each in `mapDbError` to a `werkbank` i18n key): `invoice_locked` (55000), `invalid_transition` (22023), `invoice_not_ready` (22023, with `detail` = comma-separated blockers), `order_not_done` (22023), `active_invoice_exists` (23505 on the partial index, mapped by constraint name), `number_range_locked` (55000).
- Blockers (SQL `detail` and `invoicePreflight` share the names): `no_items`, `no_service_date`, `profile_incomplete`, `no_buyer_address`, `no_recipient` (send only).
- Profile completeness for invoices: `isCompanyProfileComplete` plus a filled `iban`.
- UI: `docs/ui-conventions.md`; invoice numbers are `<Token>`, amounts `<Metric>`; status colours from `TONES`; app copy in `werkbank` namespace, EN and DE parity, Du-form, no em/en dashes, no exclamation marks. PDF and email copy German, "Sie".
- Data layer: `fn(client, orgId, ...)` with `client.schema("werkbank")`; query keys `["werkbank", "invoices", orgId, ...]`; mutations invalidate `["werkbank", "invoices"]`, and `["werkbank", "orders"]` whenever an order status can change.
- Edge: `export async function handle(req, deps, ...)`, `_shared/http.ts`, `_shared/auth.ts`; tests with `makeFakeDeps`. Signed URLs 60 s (spec R5).
- Commit messages: imperative, lowercase, at most 72 chars, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- After each task: `npx vitest run <touched dirs>`, `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`; SQL tasks `supabase test db` after `npm run local:reset`; edge tasks `deno test --allow-all <dir>` and `deno check --node-modules-dir=none` on touched functions. Before each PR: `npm run verify:fast` and `npm run sync:mirrors:check`.

## Review Focus

1. **Double "Abschließen"** (double click, two tabs, retry after a timeout): exactly one number drawn, the second call fails `invalid_transition` (SQL) or, on the edge, returns 409 `invalid_state` when a file already exists and resumes rendering when it does not. Tests in Task 3 (range advanced by exactly 1) and Task 9.
2. **Master data changes after issue** (customer renamed, address moved, profile IBAN changed): snapshots, PDF download and resend stay the issued version. Test in Task 3 (snapshot unchanged after updating the customer) and Task 10 (`send` downloads the stored file, never calls render).
3. **Billing override and private customer without property:** buyer snapshot is the property's `billing_*` block when set, else the customer; a customer without address fails `no_buyer_address`. Tests in Task 3 and Task 6.
4. **Cent rounding with discount and mixed VAT:** the XML allowances and tax totals must equal `document_totals` to the cent, or Mustang reports BR-CO errors. Fixture: lines `0.335 × 1` three times at 19 %, `12.50 × 3` at 7 %, discount 3 %. Test in Task 8 (exact sums) and the CI job of Task 11.
5. **Order reopened while its invoice is a draft:** the order goes `done → in_progress`, then finalize fails `order_not_done`; the draft stays editable and finalizes after the order is done again. Test in Task 3.

---

## PR 1: Foundation (branch `feature/werkbank-teil4-foundation`, the current branch renamed; it already carries the spec commit)

### Task 1: Runtime probe for Factur-X in the edge runtime

Throwaway; nothing of it is committed except the ledger note.

**Files:**
- Create (uncommitted): `supabase/functions/werkbank-einvoice-probe/index.ts`, `deno.json`

- [ ] **Step 1:** Write a function that renders a one-page PDF with `npm:@react-pdf/renderer@^4` and the Geist fonts from `_shared/pdf/fonts.ts` (as `quoteDocument.tsx` does), then calls `npm:@e-invoice-eu/core@3.4.0` `InvoiceService.generate(ublInput, { format: "Factur-X-EN16931", lang: "de-de", pdf: { buffer, filename: "invoice.pdf", mimetype: "application/pdf" } })` with a minimal valid UBL input (one 19 % line), and returns the bytes.
- [ ] **Step 2:** `npm run local:up`, `supabase functions serve werkbank-einvoice-probe --no-verify-jwt`, `curl -s -X POST http://127.0.0.1:54321/functions/v1/werkbank-einvoice-probe -o /tmp/probe.pdf`. Expected: HTTP 200, file starts with `%PDF`, `pdfdetach -list` (or `qpdf --list-attachments`) shows `factur-x.xml`.
- [ ] **Step 3:** Validate with Mustang locally: `java -jar Mustang-CLI-<pinned>.jar --action validate --source /tmp/probe.pdf`. Expected: `<summary status="valid"/>`. Note the boot time from the serve log.
- [ ] **Step 4:** If any step fails: stop, report to the owner, do not start Task 2. Else delete the probe folder and record the result (Mustang version, boot time) in the SDD ledger.

### Task 2: Invoice table and column additions (R1)

**Files:**
- Create: `supabase/migrations/20261008100000_werkbank_invoices.sql`
- Test: `supabase/tests/werkbank/invoices.test.sql`

**Interfaces:**
- Produces: table `werkbank.invoices` with spec R1 columns and checks verbatim; unique `(org_id, id)`; partial unique index `invoices_one_active_per_order` on `(org_id, order_id) where type = 'invoice' and status <> 'cancelled'`; `document_items.invoice_id` with composite FK and the widened `num_nonnulls(...) = 1` check (drop and recreate the Teil 3 constraint by name); `company_profiles.invoice_intro`, `invoice_closing`, `payment_due_days`; orders status check including `invoiced`; `check_property_customer` trigger attached to invoices; RLS select/insert/update/delete for admin or producer (the lock trigger of Task 3 decides what is allowed).

- [ ] **Step 1: Failing pgTAP** (pattern of `quotes_orders.test.sql`): table exists, RLS on; producer of org A inserts a free invoice draft and an item with `invoice_id` and reads both; admin of org B and a technician of org A see 0 rows; an item with `invoice_id` and `order_id` fails `23514`; `type = 'cancellation'` without `cancels_invoice_id` fails, `type = 'invoice'` with it fails; `status = 'issued'` with null `invoice_no` fails; `service_date_to` before `service_date_from` fails; a second draft invoice for the same order fails on `invoices_one_active_per_order`; a property of another customer fails `property_customer_mismatch`; `payment_due_days` 366 fails; an order can hold status `invoiced` in a direct insert as owner.
- [ ] **Step 2:** `supabase test db`. Expected: FAIL.
- [ ] **Step 3:** Write the migration; grant insert, update, delete explicitly; indexes from spec R1.
- [ ] **Step 4:** `npm run local:reset`, `supabase test db`. Expected: PASS incl. `isolation.test.sql`.
- [ ] **Step 5:** Commit `add werkbank invoices table`.

### Task 3: Locks, finalize and invoice RPCs (R2)

**Files:**
- Create: `supabase/migrations/20261008110000_werkbank_invoice_logic.sql`
- Test: `supabase/tests/werkbank/invoice_logic.test.sql`

**Interfaces:**
- Consumes: Task 2 schema; `werkbank.next_number` (replace with `create or replace`, adding `invoice` → `RE-`, 1, 4 to the seeding branch); `werkbank.order_transition()` (replace to allow `done ↔ invoiced` only when `v_owner`, and to treat `invoiced` as locked).
- Produces:
  - trigger `werkbank.lock_invoice()` on invoices and on `document_items` rows with `invoice_id` (rules of spec R2; errors `invoice_locked`); the Teil 3 draft-touch trigger extended to invoices.
  - trigger `werkbank.guard_invoice_range()` on `number_ranges` (before update or delete where `key = 'invoice'`): if the org has a non-draft invoice, `prefix`/`padding` changes and deletes fail `number_range_locked`; `next_value` may never decrease (always).
  - `werkbank.create_invoice_from_order(p_order uuid) returns uuid`
  - `werkbank.finalize_invoice(p_invoice uuid) returns werkbank.invoices`
  - `werkbank.cancel_invoice(p_invoice uuid) returns uuid`
  - `werkbank.copy_invoice(p_invoice uuid) returns uuid`
  - all four: `security definer`, `set search_path = ''`, `42501` unless caller is admin or producer of the row's org; execute to `authenticated` only.
  - Snapshot shapes (jsonb keys, used by Task 6): `seller_snapshot` = the `company_profiles` row minus `org_id`, `created_at`, `updated_at`; `buyer_snapshot` = `{ name, street, postal_code, city, country_code, customer_no, vat_id, invoice_email, is_private, billing_override: boolean, property: { name, street, postal_code, city } | null }` where name/address come from `properties.billing_*` when set, else the customer (private customers: `first_name last_name`, use the existing display rule in SQL or the customer's `company_name`; grep `displayName.ts` for the rule and mirror it in SQL).

- [ ] **Step 1: Failing pgTAP:**
  - `create_invoice_from_order` on a `done` order copies header, items with `source_item_id`, `service_date_from` = Berlin date of `completed_at`, `payment_due_days` and texts from the profile; on `in_progress` it raises `order_not_done`; a second call raises the partial-index violation.
  - `finalize_invoice` on a complete draft: `invoice_no = 'RE-0001'`, `issue_date` = Berlin today (session `set timezone = 'UTC'` first), `due_date = issue_date + 14`, `status = 'issued'`, snapshots set, the order is `invoiced`; the `invoice` range `next_value` is 2.
  - Second `finalize_invoice` on the same row raises `invalid_transition`; `next_value` is still 2 (Review Focus 1).
  - A draft without items raises `invoice_not_ready` with detail containing `no_items`; without `service_date_from` → `no_service_date`; profile without IBAN → `profile_incomplete`; afterwards `next_value` unchanged (gapless across failures).
  - Order reopened to `in_progress` with a draft invoice: finalize raises `order_not_done`; after completing the order again it succeeds (Review Focus 5).
  - After issue, as producer and as admin: update `subject`, update an item, insert an item, delete the invoice all fail `invoice_locked`; updating the customer's street leaves `buyer_snapshot` unchanged (Review Focus 2). As `service_role`: setting `pdf_path` once succeeds, a second change fails; setting `sent_at` succeeds.
  - Property with `billing_*` set: `buyer_snapshot.billing_override = true` and name from `billing_name`; private customer without property: buyer = customer address (Review Focus 3).
  - Order status `done → invoiced` by a direct update as producer fails `invalid_transition`; `invoiced → in_progress` fails.
  - `cancel_invoice` on an issued invoice returns a `cancellation` draft with the same item count and `intro_text` starting `Storno zu RE-0001 vom `; a second call fails; on a draft it raises `invalid_transition`. Finalizing the cancellation gives `RE-0002`, original `cancelled`, order `done`.
  - `copy_invoice` of the cancelled original returns an `invoice` draft keeping `order_id` (order is `done`, no active invoice); copying an issued, not cancelled invoice returns a draft with `order_id` null.
  - Number range: after the first issue, changing the `invoice` prefix fails `number_range_locked`; lowering `next_value` fails always; raising it succeeds.
  - Technician of the org and admin of another org get `42501` from all four RPCs.
- [ ] **Step 2:** `supabase test db`. Expected: FAIL.
- [ ] **Step 3:** Write the migration. `finalize_invoice` order: `select ... for update` on the invoice, check `draft`, collect blockers, raise `invoice_not_ready` if any, then draw the number, so a failure never touches the range.
- [ ] **Step 4:** Reset and rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add invoice locks, finalize and cancel rpcs`.

### Task 4: Totals, list view and immutable storage (R3, R4)

**Files:**
- Create: `supabase/migrations/20261008120000_werkbank_invoice_views.sql`
- Test: `supabase/tests/werkbank/invoice_views.test.sql`

**Interfaces:**
- Produces: `werkbank.document_totals` with columns `quote_id, order_id, invoice_id, net_total, discount_total, vat_total, gross_total, labour_total, vat_breakdown` (adding `invoice_id` as a new column in the existing branches as `null::uuid`; `create or replace view` cannot reorder columns, so drop and recreate the view and the dependent `quote_list`/`order_list` in the same migration with their current definitions copied from `20261007220000_werkbank_teil3_polish.sql`); view `werkbank.invoice_list` (`security_invoker = true`): every `invoices` column plus `customer_name`, `property_name`, `gross_total`, `net_total`, `cancelled_by_no` (number of the cancellation that cancels it), `cancels_no` (number of the original); trigger `werkbank.protect_invoice_files()` on `storage.objects` before update or delete where `bucket_id = 'werkbank-documents'` and `(storage.foldername(name))[2] = 'invoices'`, raising `invoice_locked`.

- [ ] **Step 1: Failing pgTAP:** an invoice created from an order has the same `net_total`, `vat_total`, `gross_total`, `vat_breakdown` as the order in `document_totals`; `quote_list` and `order_list` still return their Teil 3 columns (select a known column set); `invoice_list` shows `cancelled_by_no` on the original after a cancellation is issued; as `service_role`, inserting an object `<org>/invoices/x.pdf` succeeds and updating or deleting it fails; an object under `<org>/quotes/` can still be deleted; admin of another org sees 0 rows in `invoice_list`.
- [ ] **Step 2:** `supabase test db`. Expected: FAIL.
- [ ] **Step 3:** Write the migration. If `isolation.test.sql` or `scripts/moduleIsolation.test.ts` flags the `storage.objects` trigger, add a named allow-list entry with the reason from spec R4.
- [ ] **Step 4:** Reset and rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add invoice totals, list view and file protection`.

### Task 5: Types, document refs and invoice preflight

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerated, `--schema public,graphql_public,werkbank` against the local stack), `supabase/functions/_shared/database.types.ts` (via `npm run sync:mirrors`), `src/features/werkbank/data/documentItems.ts` (`DocumentRef`, `refColumn`), `src/features/werkbank/lib/dbErrors.ts` (new messages), `src/features/werkbank/i18n/{en,de}.json` (error keys), `scripts/mirrors.manifest.json`
- Create: `src/features/werkbank/lib/invoicePreflight.ts` (+ test), generated target `supabase/functions/_shared/werkbank/invoicePreflight.ts`

**Interfaces:**
- Produces:
  - `type DocumentRef = { quoteId: string } | { orderId: string } | { invoiceId: string }`; `refColumn` returns `"invoice_id"` for the new case (the `orgScoping.test.ts` literal `.eq("invoice_id", ...)` must appear).
  - `type InvoiceBlocker = "no_items" | "no_service_date" | "profile_incomplete" | "no_buyer_address" | "no_recipient"`
  - `invoicePreflight(input: { profile: (CompanyProfileLike & { iban: string | null }) | null; itemCount: number; serviceDateFrom: string | null; buyer: { street: string | null; postal_code: string | null; city: string | null } | null; recipients: string[] | null }): InvoiceBlocker[]` (pure; its only import is `isCompanyProfileComplete` and `CompanyProfileLike` from `./quotePreflight`, which resolves in both runtimes because both files are mirrored into the same directories; `recipients: null` means "issue without sending" and skips `no_recipient`).

- [ ] **Step 1: Failing tests** `invoicePreflight.test.ts`: complete input gives `[]`; each blocker alone; order of blockers is the type's order; `recipients: null` never yields `no_recipient`, `[]` does; profile with tax number but empty IBAN gives `profile_incomplete`. `documentItems.test.ts`: `fetchItems(client, { invoiceId: "i1" })` filters `.eq("invoice_id", "i1")`. `dbErrors.test.ts`: each new message maps to its key.
- [ ] **Step 2:** `npx vitest run src/features/werkbank`. Expected: FAIL.
- [ ] **Step 3:** Regenerate types, implement, add the manifest entry (mode `file`, why: "Invoice issue preflight shared by the issue dialog and werkbank-invoices"), `npm run sync:mirrors`.
- [ ] **Step 4:** Rerun plus `npm run sync:mirrors:check`, `npx tsc -p tsconfig.app.json --noEmit`, `npx vitest run scripts`. Expected: PASS.
- [ ] **Step 5:** Commit `add invoice types, document ref and preflight`. Open PR 1.

## PR 2: E-invoice and sending (branch `feature/werkbank-teil4-einvoice`, from main after PR 1)

### Task 6: Invoice data builder

**Files:**
- Create: `supabase/functions/_shared/werkbank/einvoice/invoiceData.ts` (+ `invoiceData.test.ts`)

**Interfaces:**
- Consumes: `Database["werkbank"]` row types (invoices, document_items, document_totals), snapshot shapes of Task 3.
- Produces:
  - `type InvoiceData = { type: "invoice" | "cancellation"; number: string; issueDate: string; dueDate: string; serviceFrom: string; serviceTo: string | null; seller: SellerSnapshot; buyer: BuyerSnapshot; subject: string | null; intro: string | null; closing: string | null; paymentTerms: string | null; precedingInvoice: { number: string; issueDate: string } | null; sections: QuotePdfData["sections"]; lines: Array<{ id: string; name: string; description: string | null; quantity: number; unitCode: string; unitPrice: number; lineNet: number; vatRate: number }>; totals: { net: number; discountPercent: number; discount: number; vat: Array<{ rate: number; net: number; discountedNet: number; vat: number }>; gross: number; labour: number | null }; watermark?: "Entwurf" }`
  - `buildInvoiceData(input: { invoice; items; totals; preceding?: { invoice_no: string; issue_date: string } | null; draftFallback?: { seller; buyer } }): InvoiceData` (pure; `labour` only when `buyer.is_private`; draft preview uses `draftFallback` because snapshots are null; `sections` built with the same numbering helper `quoteData.ts` uses: import it, extract it from `quoteData.ts` into `_shared/werkbank/pdf/sections.ts` if it is not exported).

- [ ] **Step 1: Failing tests:** totals copied from the view row (no arithmetic: a deliberately odd `vat_total` passes through unchanged); `labour` null for a business buyer, set for private; cancellation carries `precedingInvoice`; sections number `1`, `1.1`, `2`; text rows are not in `lines`; billing override buyer name used (Review Focus 3).
- [ ] **Step 2:** `deno test --allow-all supabase/functions/_shared/werkbank/einvoice/`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun plus `deno test` of `_shared/werkbank/pdf/` if `sections.ts` was extracted. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank invoice data builder`.

### Task 7: Invoice PDF document

**Files:**
- Create: `supabase/functions/_shared/werkbank/einvoice/invoiceDocument.tsx` (+ `invoiceDocument.test.tsx`)

**Interfaces:**
- Consumes: `InvoiceData` (Task 6), `registerQuoteFonts` and the layout primitives of `_shared/werkbank/pdf/quoteDocument.tsx` (export shared header/footer/table pieces from there rather than copying them).
- Produces: `renderInvoicePdf(data: InvoiceData): Promise<Uint8Array>`.

- [ ] **Step 1: Failing tests:** output starts with `%PDF`; the text layer (decode with the helper `quote.test.tsx` uses) contains `Rechnung RE-0001`, `Leistungsdatum`, `Fällig am`, the IBAN, the seller tax number; a cancellation contains `Stornorechnung` and `zu Rechnung RE-0001 vom`; a private buyer shows `davon Lohnanteil (§35a EStG)`, a business buyer does not; watermark `Entwurf` appears when set; every font in the file is embedded (no `/BaseFont /Helvetica` without `/FontFile`).
- [ ] **Step 2:** `deno test --allow-all supabase/functions/_shared/werkbank/einvoice/`. Expected: FAIL.
- [ ] **Step 3:** Implement the R6.2 content; German copy, no dashes.
- [ ] **Step 4:** Rerun plus `deno test` of `_shared/werkbank/pdf/` and `deno check`. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank invoice pdf document`.

### Task 8: Factur-X mapping and rendering

**Files:**
- Create: `supabase/functions/_shared/werkbank/einvoice/facturx.ts` (+ `facturx.test.ts`), `einvoice/renderEInvoice.ts` (+ test)

**Interfaces:**
- Consumes: `InvoiceData`, `renderInvoicePdf`.
- Produces:
  - `toUblInput(data: InvoiceData): Invoice` (the `@e-invoice-eu/core` UBL type): BT-3 `380` or `381`; BT-25/26 from `precedingInvoice`; BT-72 from `serviceFrom` when `serviceTo` is null, else BG-14 period; BT-9 `dueDate`; BT-20 `paymentTerms`; BG-16 code `58` with seller IBAN/BIC; one BG-20 allowance per VAT rate with amount `net - discountedNet` and reason `Rabatt`; BG-23 per rate from `totals.vat`; BT-106 = sum of `lineNet`, BT-109 = sum of `discountedNet`, BT-110 = sum of `vat`, BT-112 = `gross`; unit codes are UN/ECE rec 20 as stored; currency `EUR`; seller VAT id or tax number (BT-31/BT-32); buyer from `buyer`.
  - `renderEInvoice(data: InvoiceData): Promise<Uint8Array>` (PDF from `renderInvoicePdf`, then `InvoiceService.generate` with format `Factur-X-EN16931`, lang `de-de`).

- [ ] **Step 1: Failing tests:** with the Review Focus 4 fixture (built through `buildInvoiceData` from a hand-written `document_totals` row that equals what the view returns for those lines, copied from the Task 4 pgTAP run): BT-106/109/110/112 equal the view values exactly; allowances sum to `discount`; a cancellation has type `381` and the billing reference; mixed 19/7/0 produces three BG-23 entries and the 0 % one uses category `Z`; `renderEInvoice` output contains the attachment name `factur-x.xml` and the XML string `urn:cen.eu:en16931:2017`.
- [ ] **Step 2:** `deno test --allow-all supabase/functions/_shared/werkbank/einvoice/`. Expected: FAIL.
- [ ] **Step 3:** Implement with `npm:@e-invoice-eu/core@3.4.0`.
- [ ] **Step 4:** Rerun and `deno check`. Expected: PASS.
- [ ] **Step 5:** Commit `map werkbank invoices to factur-x`.

### Task 9: `werkbank-invoices` preview, issue, download

**Files:**
- Create: `supabase/functions/werkbank-invoices/index.ts`, `deno.json` (copy of `werkbank-quotes/deno.json` plus the e-invoice import), `index.test.ts`
- Modify: `supabase/config.toml` (`[functions.werkbank-invoices] verify_jwt = true`)

**Interfaces:**
- Consumes: `buildInvoiceData`, `renderEInvoice`, `renderInvoicePdf`, `invoicePreflight`, `requireOrgRole`, `resolveOrgKind`.
- Produces: `export async function handle(req: Request, deps: Deps, render = { pdf: renderInvoicePdf, einvoice: renderEInvoice }): Promise<Response>`; actions
  - `preview { org_id, invoice_id } → { pdf_base64 }` (draft only, watermark, no XML, no writes)
  - `issue { org_id, invoice_id, send?: { to: string[]; cc: string[]; message: string } } → { ok: true, invoice_no, email_sent?: boolean }`
  - `download-url { org_id, invoice_id } → { url }`
  - errors: `forbidden` 403, `not_handwerk` 403, `not_found` 404, `preflight_failed` 422 `{ blockers }`, `invalid_state` 409, `render_failed` 500 with `issued: true`.

- [ ] **Step 1: Failing tests:** other-org producer 403; non-handwerk 403; `preview` returns base64 and records no rpc, update or storage call; `issue` on a draft calls the `finalize_invoice` rpc through the user client (not the admin client), then uploads to `werkbank-documents/<org>/invoices/<id>.pdf` with `upsert: false`, then updates `pdf_path` and `pdf_sha256` (= SHA-256 hex of the uploaded bytes) through the admin client; rpc error `invoice_not_ready` with detail `no_items` → 422 `{ blockers: ["no_items"] }`; render throwing after finalize → 500 `{ error: "render_failed", issued: true }` and no update; `issue` on `issued` without `pdf_path` skips the rpc and renders (resume); `issue` on `issued` with `pdf_path` → 409 (Review Focus 1); `download-url` returns a signed URL with 60 s.
- [ ] **Step 2:** `deno test --allow-all supabase/functions/werkbank-invoices/`. Expected: FAIL.
- [ ] **Step 3:** Implement (structure of `werkbank-quotes/index.ts`; `send` is wired in Task 10, so `issue` with `send` returns 400 `unsupported` until then).
- [ ] **Step 4:** Rerun, `deno check --node-modules-dir=none supabase/functions/werkbank-invoices/index.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank-invoices preview, issue and download`.

### Task 10: Sending and the `invoice-sent` email

**Files:**
- Create: `supabase/functions/_shared/werkbank/emails/invoice-sent.tsx` (+ test next to `quoteEmails.test.tsx`)
- Modify: `supabase/functions/werkbank-invoices/index.ts` (+ test), `_shared/transactional-email-templates/registry.ts`, `src/lib/emailTemplates/emailCopy.ts` (key + default, then `npm run sync:mirrors`), `_shared/notificationCategories.ts` (transactional)

**Interfaces:**
- Produces: action `send { org_id, invoice_id, to: string[], cc: string[], message: string } → { ok: true, email_sent: boolean }`; `issue` with `send` runs `send` after storing; template data `{ companyName, invoiceNo, kind: "invoice" | "cancellation", precedingNo?, grossFormatted, dueDateFormatted, message }`, subject `Rechnung RE-0001 von <Firma>` or `Stornorechnung RE-0002 zu RE-0001`.

- [ ] **Step 1: Failing tests:** `send` on `issued` downloads the stored file and passes it as the one attachment (`<invoice_no>.pdf`, base64 of the stored bytes); `render` is never called (Review Focus 2); `reply_to` = seller snapshot email; `sent_at` and `sent_to` (to + cc) updated; empty `to` → 422 `["no_recipient"]`; `send` on a draft → 409; email failure → 502 `{ error: "send_failed", issued: true }` with no `sent_at` update; `issue` with `send` returns `email_sent: true`; a `cancelled` original can still be resent. Email test: subject for both kinds, German Sie copy, no dashes.
- [ ] **Step 2:** Run `deno test --allow-all supabase/functions/werkbank-invoices/ supabase/functions/_shared/werkbank/emails/`. Expected: FAIL.
- [ ] **Step 3:** Implement; template modelled on `quote-sent.tsx`.
- [ ] **Step 4:** Rerun, plus `npx vitest run scripts src/lib/emailTemplates`, `npm run sync:mirrors:check`. Expected: PASS.
- [ ] **Step 5:** Commit `send werkbank invoices by email`.

### Task 11: Mustang validation job and org export

**Files:**
- Create: `scripts/werkbank/einvoice-fixtures.ts` (Deno; writes fixture PDFs to a directory given as argument), `.github/workflows/einvoice-validate.yml` (or a job in `ci.yml`, whichever pattern the repo uses for path-filtered jobs)
- Modify: `supabase/functions/export-org-data/index.ts` (+ its test) to include `invoices`

**Interfaces:**
- Consumes: `buildInvoiceData`, `renderEInvoice`.

- [ ] **Step 1:** Fixture script renders four files through the real pipeline: plain 19 %, Review Focus 4 discount fixture, mixed 19/7/0, cancellation. `deno run --allow-read --allow-write --allow-env scripts/werkbank/einvoice-fixtures.ts /tmp/einv` writes 4 PDFs.
- [ ] **Step 2:** CI job: `actions/setup-java` (temurin 17), download the pinned Mustang CLI jar and check its SHA-256 (store version and hash in the workflow), run the fixture script, then `java -jar mustang.jar --action validate --source <file>` per file; fail unless every report has `status="valid"` and zero errors. Runs on changes to `supabase/functions/_shared/werkbank/einvoice/**`, `supabase/functions/werkbank-invoices/**`, the script, and the workflow. Run it locally once. Expected: 4 valid.
- [ ] **Step 3: Failing test** in `export-org-data`: the bundle's `werkbank.invoices` contains the org's invoices. Implement by adding the table to the list. Rerun. Expected: PASS.
- [ ] **Step 4:** Commit `validate werkbank e-invoices with mustang in ci`. Open PR 2.

## PR 3: UI (branch `feature/werkbank-teil4-ui`, from main after PR 2)

### Task 12: Invoice data layer and hooks

**Files:**
- Create: `src/features/werkbank/data/invoices.ts`, `data/invoiceActions.ts`, `hooks/useInvoices.ts`, `hooks/useInvoiceActions.ts` (+ tests)

**Interfaces:**
- Produces:
  - `type InvoiceListRow = Database["werkbank"]["Views"]["invoice_list"]["Row"]`; `type InvoiceFilter = "all" | "draft" | "issued" | "cancelled"`
  - `fetchInvoices(client, orgId, { filter, search, customerId?, propertyId? }): Promise<InvoiceListRow[]>` (through `fetchAllPages`; search `ilike` over number, customer, property, subject as in `fetchQuotes`)
  - `fetchInvoice(client, orgId, id)`, `createFreeInvoice(client, orgId, { customerId, propertyId?, profile }): Promise<string>` (prefills texts and `payment_due_days`), `updateInvoice(client, orgId, id, patch)`, `deleteInvoice(client, orgId, id)`
  - `createInvoiceFromOrder(client, orderId)`, `cancelInvoice(client, id)`, `copyInvoice(client, id)` (rpcs, return the new id)
  - `previewInvoice(client, orgId, id): Promise<string>` (base64), `issueInvoice(client, orgId, id, send?)`, `sendInvoice(client, orgId, id, payload)`, `invoiceDownloadUrl(client, orgId, id)` (via `client.functions.invoke("werkbank-invoices", ...)`, errors surfaced as in `quoteActions.ts`)
  - hooks `useInvoices`, `useInvoice`, `useInvoiceMutations` (create, update, delete, fromOrder, cancel, copy), `useIssueInvoice`, `useSendInvoice`, `usePreviewInvoice`, `useInvoiceDownload`
- [ ] **Step 1: Failing tests** with `supabaseFake`: `fetchInvoices` with filter `issued` adds `.eq("status","issued")` and `.eq("org_id", orgId)`; `createFreeInvoice` inserts `payment_due_days` and texts from the profile; `issueInvoice` invokes `werkbank-invoices` with `action: "issue"`; a 422 response becomes an error carrying `blockers`; mutation hooks invalidate `["werkbank","invoices"]` and, for fromOrder/issue/cancel, `["werkbank","orders"]`.
- [ ] **Step 2:** `npx vitest run src/features/werkbank/data src/features/werkbank/hooks`. Expected: FAIL.
- [ ] **Step 3:** Implement following `quotes.ts` and `quoteActions.ts`.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank invoice data layer and hooks`.

### Task 13: Order status `invoiced` and "Rechnung erstellen"

**Files:**
- Modify: `src/features/werkbank/lib/orderStatus.ts` (+ test), `pages/OrderPage.tsx` (+ test), `pages/OrdersPage.tsx` (+ test), `i18n/{en,de}.json`

**Interfaces:**
- Produces: `ORDER_STATUSES` includes `invoiced`; `ORDER_STATUS_TONES.invoiced` a settled tone from `TONES` (same family as `done`); `nextOrderActions("invoiced") = []`; `nextOrderActions("done")` unchanged.

- [ ] **Step 1: Failing tests:** `nextOrderActions("invoiced")` is empty; OrderPage on `done` shows "Rechnung erstellen", clicking calls `createInvoiceFromOrder` and navigates to `/invoices/<id>`; on `invoiced` it shows "Abgerechnet", a link to the invoice (looked up by `order_id` with `status <> 'cancelled'`), a read-only editor and no status actions; OrdersPage filter offers Abgerechnet.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `show invoiced orders and create invoices from orders`.

### Task 14: Invoices list, nav and page mini

**Files:**
- Create: `src/features/werkbank/pages/InvoicesPage.tsx` (+ test), `src/lib/minis/pages/invoices.ts`, `src/components/minis/illustrations/InvoicesMini.tsx`, `src/features/werkbank/lib/invoiceStatus.ts` (+ test)
- Modify: `src/features/werkbank/ui.ts` (nav item after Aufträge, route `/invoices` and `/invoices/:id`), `paths.ts`, `src/lib/minis/index.ts`, `src/components/minis/illustrations/index.ts`, `src/i18n/terms.ts`, `i18n/{en,de}.json`

**Interfaces:**
- Produces: `INVOICE_STATUS_TONES: Record<"draft" | "issued" | "cancelled", Tone>`; `signedGross(row: { type: string; gross_total: number }): number` (negative for cancellations); paths `invoicesPath()`, `invoicePath(id)`.

- [ ] **Step 1: Failing tests:** list renders rows with `Token` number or "Entwurf", cancellation rows show a negative `Metric` and a Storno pill; filter switch refetches with the filter; search is debounced; the "Erledigt, noch nicht abgerechnet" notice shows the count of `done` orders and links to `/orders?status=done`; "Rechnung anlegen" opens the customer picker dialog and navigates to the new draft; `minis.test.ts` and `copyLint.test.ts` pass with the new mini.
- [ ] **Step 2:** Run `npx vitest run src/features/werkbank src/lib/minis src/i18n`. Expected: FAIL.
- [ ] **Step 3:** Implement with `PageHeader`, `SegmentedControl`, `PageMini`, `EmptyState`.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank invoices list`.

### Task 15: Invoice page, draft and issue dialog

**Files:**
- Create: `src/features/werkbank/pages/InvoicePage.tsx` (+ test), `components/InvoiceHeaderForm.tsx`, `components/IssueInvoiceDialog.tsx` (+ test)

**Interfaces:**
- Consumes: `DocumentHeaderFields`, `LineItemsEditor` with `{ invoiceId }`, `DocumentTotalsCard`, `DatePopover`, `invoicePreflight`, Task 12 hooks.

- [ ] **Step 1: Failing tests:** draft shows header with service date from/to and payment term, editor and totals; Vorschau opens the preview via `pdfTab.ts`; Löschen deletes and returns to the list; the issue dialog lists the blockers from `invoicePreflight` and disables both buttons when blocked; recipient prefilled with customer `invoice_email`, else contact email, else customer email; "Nur abschließen" calls `issueInvoice` without `send`; "Abschließen und senden" passes `to`/`cc`/`message`; a 502 `send_failed` shows "Abgeschlossen, Versand fehlgeschlagen" and the page refetches into the issued state; a 409 refetches (Review Focus 1); the warning "Danach ist die Rechnung nicht mehr änderbar." is shown.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement, modelled on `QuotePage.tsx` and `SendQuoteDialog.tsx`.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank invoice page and issue dialog`.

### Task 16: Issued and cancelled invoice states

**Files:**
- Create: `src/features/werkbank/components/InvoiceActions.tsx` (+ test), `components/InvoiceHistory.tsx`
- Modify: `pages/InvoicePage.tsx` (+ `InvoicePage.locked.test.tsx`)

- [ ] **Step 1: Failing tests:** issued: read-only header and items, actions PDF (signed URL), Senden or Erneut senden (dialog reuse of Task 15 in send mode), Stornieren (confirm, then navigate to the cancellation draft), Kopieren; issued without `pdf_path`: "PDF wird erzeugt" with "Erneut versuchen" calling `issueInvoice`; cancelled original: banner linking `cancelled_by_no`, action "Korrigierte Rechnung anlegen" calling `copyInvoice`; cancellation: title "Stornorechnung", link to the original, negative totals; history lists issued, sent (to whom) and cancelled-by.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add issued and cancelled invoice views`.

### Task 17: Settings, documents sections, start list

**Files:**
- Modify: `components/CompanyTab.tsx` (+ test), `components/NumberingTab.tsx` (+ test), `components/DocumentsSection.tsx` (+ test), `data/startList.ts` (+ test), `components/StartList.tsx`, `i18n/{en,de}.json`

- [ ] **Step 1: Failing tests:** CompanyTab saves `payment_due_days` (0 to 365), `invoice_intro`, `invoice_closing`; NumberingTab shows the `invoice` range and disables prefix and start inputs when the org has an issued invoice (and shows `number_range_locked` copy on a server rejection); DocumentsSection on customer and property pages lists invoices with number, subject, status, signed gross and a create action preselecting customer and property; start list step `invoice` is done when a non-draft invoice exists.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add invoice settings, sections and start step`.

### Task 18: Help, changelog, system map, end-to-end

**Files:**
- Modify: `src/lib/help/items.ts` (EN + DE, Du, `kinds: ['handwerk']`: create from order, free invoice, issue and GoBD lock, cancel and correct, e-invoice), `public/changelog.md` + `public/changelog.json`, `docs/system-map.md` + `src/data/systemMap.ts` (`werkbank-invoices` actions, `invoice-sent`), `package.json` + `src/config/app.config.ts` (MINOR bump)
- Create: `e2e/werkbank-invoices.spec.ts`

- [ ] **Step 1:** Help items, changelog block (CLAUDE.md format, user-facing bullets only), `deno run --allow-read --allow-write scripts/changelog-to-json.ts`, system map entries. Run `npx vitest run src/lib/help src/i18n src/data`. Expected: PASS.
- [ ] **Step 2: Playwright** on the local stack: admin completes the company profile with IBAN; creates and completes an order for a seeded customer; "Rechnung erstellen"; sets the service date; "Nur abschließen"; sees `RE-0001` and the order "Abgerechnet"; "Stornieren", issues the cancellation (`RE-0002`), sees the order "Erledigt"; "Korrigierte Rechnung anlegen", issues it (`RE-0003`); downloads the PDF and asserts it contains `factur-x.xml`.
- [ ] **Step 3:** `npx playwright test --config=e2e/playwright.config.ts e2e/werkbank-invoices.spec.ts`. Expected: PASS. Then `npm run verify:full`.
- [ ] **Step 4:** Commit `add teil 4 help, changelog, system map and e2e`. Open PR 3.
