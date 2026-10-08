# Werkbank Teil 5: Open items and dunning. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office records payments, write-offs, refunds and transfers against issued invoices, sees open and overdue amounts, and sends up to three dunning notices per invoice as stored PDF letters by email or for post.

**Architecture:** Schema `werkbank` gains `invoice_entries`, `dunning_notices`, `dunning_holds` (select-only for `authenticated`; all writes through SECURITY DEFINER RPCs that lock the invoice row) and two views, `invoice_balances` and `dunning_due`, computed from `document_totals`. A new edge function `werkbank-dunning` renders the notice PDF in the invoice letter style, stores it immutably and sends it with the original invoice PDF. UI in `src/features/werkbank`: a new open items page, payments and dunning cards on the invoice page, settings, and a `DefaultHint` tooltip for every preset value.

**Tech Stack:** Postgres/pgTAP, Supabase Storage + Edge Functions (Deno), `@react-pdf/renderer`, React 18 + React Query, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-werkbank-offene-posten-design.md` (requirement ids R1 to R8 refer to it). Teil 4 spec and plan (`2026-10-08-werkbank-rechnung*`) describe the invoice pieces reused here.

## Global Constraints

- CLAUDE.md "Reuse before you build" and the spec's Reuse map: no local copies of `fetchAllPages`, `mapDbError`, `formatEuro`, `IconTooltip`, `KpiTile`, `StatusPill`, the invoice letterhead (`SellerHeader`, `PageFooter`, `ItemRow`, `money`, `s` from `_shared/werkbank/pdf/quoteDocument.tsx`), `checkRecipients`, `documentStorage.ts`.
- Isolation: Werkbank code only in `src/features/werkbank/**`, `supabase/functions/werkbank-*/**`, `supabase/functions/_shared/werkbank/**`, `supabase/migrations/*_werkbank_*.sql`, `supabase/tests/werkbank/**`, `e2e/werkbank-*.spec.ts`, plus the allow-listed touch points in `scripts/moduleIsolation.test.ts` (help items, `export-org-data`, `src/lib/minis`, `src/components/minis`, `docs/ui-conventions.md` needs no entry). No change to `src/components/layout/navItems.ts` (no nav badge, spec Non-goals).
- The three new tables: RLS on, `grant select` only to `authenticated`, no insert/update/delete grants; FKs to `public.organizations` `on delete cascade`. Every new function: `revoke all ... from public, anon`, explicit `grant execute`, role check admin or producer of the invoice's org, `set search_path = ''`, `select ... for update` on the invoice row first.
- Owner detection in triggers as in Teil 3 and 4: `current_user not in ('authenticated','anon','service_role')` = SECURITY DEFINER body; `current_user = 'service_role'` = edge function. Reversal columns are writable only when `current_setting('werkbank.entry_reversal', true) = 'on'`, set with `set_config(..., true)` inside the two RPCs.
- Migrations: `20261008130000_werkbank_open_items.sql`, `20261008140000_werkbank_open_items_logic.sql`, `20261008150000_werkbank_open_items_views.sql`; never edit existing migrations; never apply to production by hand.
- Kinds and states (exact strings): entry `kind` `payment|refund|write_off`; `write_off_reason` `skonto|goodwill|bad_debt|other`; `delivery` `email|print`; `payment_state` `open|partial|paid|written_off|overpaid|void`; `stage` 1, 2, 3.
- Settings defaults: `reminder_after_days` 7, `dunning1_after_days` 14, `dunning2_after_days` 14, `dunning_deadline_days` 7, all `between 0 and 365`.
- Dates are Berlin dates: `(now() at time zone 'Europe/Berlin')::date` in SQL, `berlinDateKey` from `src/lib/dates.ts` in TS.
- SQL error messages (each mapped in `mapDbError` to a `werkbank` key): `entries_locked` (55000), `dunning_locked` (55000, also the storage trigger for `dunning/`), `not_payable` (22023), `future_booking_date` (22023), `refund_exceeds_credit` (22023), `nothing_open` (22023), `open_amount_changed` (22023), `already_reversed` (22023), `transfer_target_invalid` (22023), `dunning_not_allowed` (22023, `detail` = comma-separated blockers).
- Dunning blockers (SQL `detail`, the dialog and the disabled-button tooltip share the names): `not_issued`, `not_overdue`, `nothing_open`, `on_hold`, `previous_stage_open`, `max_stage`.
- Notice file path `<org_id>/dunning/<notice_id>.pdf` in bucket `werkbank-documents`; signed URLs 60 s.
- UI: `docs/ui-conventions.md`; invoice numbers `<Token>`, amounts and day counts `<Metric>`; tones from `TONES` (amber overdue, red from stage 2); app copy in the `werkbank` namespace, EN and DE parity, Du-form, no em/en dashes, no exclamation marks; PDF and email German, "Sie". Every preset value gets a `DefaultHint` (spec R8).
- Data layer: `fn(client, orgId, ...)` with `client.schema("werkbank")`; query keys `["werkbank", "open-items", orgId, ...]`; every mutation invalidates `["werkbank", "open-items"]` and `["werkbank", "invoices"]`.
- Edge: `export async function handle(req, deps, render = {...})`, `_shared/http.ts`, `_shared/auth.ts`; tests with `makeFakeDeps`.
- Mirrors: new pure modules shared by both runtimes are `file` entries in `scripts/mirrors.manifest.json` (source in `src/features/werkbank/lib/`); run `npm run sync:mirrors`, never edit a target.
- Commit messages: imperative, lowercase, at most 72 chars, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- After each task: `npx vitest run <touched dirs>`, `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`; SQL tasks `npm run local:reset` then `supabase test db`; edge tasks `deno test --allow-all <dir>` and `deno check --node-modules-dir=none` on touched functions (restore `deno.lock` afterwards if `deno check` rewrote it). Before each PR: `npm run verify:fast` and `npm run sync:mirrors:check`.

## Review Focus

1. **Double submit and stale amounts** (double click on "Rest ausbuchen", two tabs, a payment recorded in another tab while the write-off dialog is open): the row lock serializes; the second write-off fails `nothing_open`, a stale amount fails `open_amount_changed`, the dialog reloads the balance and says so. Tests in Task 2 and Task 9.
2. **Invoice paid between selection and bulk send:** the row fails `dunning_not_allowed` with `nothing_open`; the summary counts it as "übersprungen", not as a failure, and the list refreshes. Tests in Task 6 (edge returns 409 with the blocker) and Task 11.
3. **Cancellation after payments and notices:** the original leaves `dunning_due`, its balance becomes credit (`overpaid`), earlier notices stay listed read-only, and no new notice or payment is possible on it. Tests in Task 3 and Task 10.
4. **German amount input** ("1.190,50", "1190,5", "12,345", "-5"): parsed to 1190.50 and 1190.50; more than two decimals and non-positive values are rejected in the form before the RPC. Test in Task 4 (`parseEuroInput`) and Task 9.
5. **Berlin midnight:** a payment entered at 00:30 Berlin (22:30 UTC the day before) defaults to and accepts the Berlin date; a notice for an invoice due "yesterday Berlin" is allowed right after midnight. Tests in Task 2 (run with `set local timezone 'UTC'`; the RPCs compute the Berlin date themselves) and Task 9 (fake timers).

---

## PR 1: Foundation (branch `feature/werkbank-teil5-foundation`, the current branch renamed; it already carries the spec and plan commits)

### Task 1: Tables and settings columns (R1)

**Files:**
- Create: `supabase/migrations/20261008130000_werkbank_open_items.sql`
- Test: `supabase/tests/werkbank/open_items.test.sql`

**Interfaces:**
- Produces: tables `werkbank.invoice_entries`, `werkbank.dunning_notices`, `werkbank.dunning_holds` with the spec R1 columns, checks and indexes verbatim; unique `(org_id, id)` on each for composite FKs; `invoice_entries_one_reversal` check (all three reversal columns null or all set); `dunning_notices_stage_unique (invoice_id, stage)`; RLS select policy for admin or producer of the org (`werkbank` helper used by `invoices`); `company_profiles` columns `reminder_after_days`, `dunning1_after_days`, `dunning2_after_days`, `dunning_deadline_days`, `reminder_text`, `dunning1_text`, `dunning2_text`.

- [ ] **Step 1: Failing pgTAP** (pattern of `invoices.test.sql`): tables exist with RLS on; `authenticated` has select and no insert/update/delete privilege on each (`table_privs_are`); a row inserted as owner is visible to a producer of org A and invisible to an admin of org B and to a technician of org A; `kind = 'write_off'` without reason fails `23514`; `write_off_reason = 'other'` with null note fails; `amount = 0` fails; reversal with only `reversed_at` set fails; `stage = 4` fails; a second stage 1 for the same invoice fails `23505`; `payment_deadline < notice_date` fails; `company_profiles.reminder_after_days` defaults to 7 and 366 fails.
- [ ] **Step 2:** `supabase test db`. Expected: FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `npm run local:reset`, `supabase test db`. Expected: PASS incl. `isolation.test.sql`.
- [ ] **Step 5:** Commit `add werkbank open items tables`.

### Task 2: Lock triggers and RPCs (R2)

**Files:**
- Create: `supabase/migrations/20261008140000_werkbank_open_items_logic.sql`
- Test: `supabase/tests/werkbank/open_items_logic.test.sql`

**Interfaces:**
- Consumes: Task 1 tables; `werkbank.document_totals`; the role-check helper used by `finalize_invoice`.
- Produces (signatures exact, errors from Global Constraints):
  - triggers `werkbank.lock_invoice_entry()` (no delete; update only of the three reversal columns, once, from null, with the `werkbank.entry_reversal` setting; else `entries_locked`) and `werkbank.lock_dunning_notice()` (no delete; service role may set `pdf_path`/`pdf_sha256` once and update `sent_at`/`sent_to`; owner may do anything the RPC needs; else `dunning_locked`).
  - private helper `werkbank.invoice_open_amount(p_invoice uuid) returns numeric` (claim minus non-reversed payments plus refunds minus write-offs; claim 0 when cancelled), used by the RPCs and by Task 3's view so the rule exists once.
  - `werkbank.record_invoice_entry(p_invoice uuid, p_kind text, p_amount numeric, p_booked_on date, p_note text default null, p_write_off_reason text default null) returns uuid`
  - `werkbank.reverse_invoice_entry(p_entry uuid, p_reason text) returns void`
  - `werkbank.transfer_invoice_entry(p_entry uuid, p_target_invoice uuid, p_reason text) returns uuid`
  - `werkbank.create_dunning_notice(p_invoice uuid, p_delivery text, p_payment_deadline date) returns werkbank.dunning_notices` (stage = max + 1; amounts snapshot from `document_totals` and the helper; `notice_date` Berlin today)
  - `werkbank.set_dunning_hold(p_invoice uuid, p_reason text, p_until date default null) returns void` (upsert), `werkbank.clear_dunning_hold(p_invoice uuid) returns void`

- [ ] **Step 1: Failing pgTAP**, one assertion group per rule of spec R2:
  - direct `insert` into each table as producer fails `42501`; an owner update of `amount` without the reversal setting fails `entries_locked`; delete fails.
  - payment of 100 on an issued 1190 invoice → open 1090; payment on a draft and on a cancellation invoice fails `not_payable`; `p_booked_on` = Berlin today + 1 fails `future_booking_date`.
  - write-off with `p_amount` 1090 succeeds and open is 0; a second write-off fails `nothing_open`; write-off with 1000 while open is 1090 fails `open_amount_changed`; write-off without reason fails.
  - payment of 1300 on a 1190 invoice succeeds (open −110); refund 120 fails `refund_exceeds_credit`; refund 110 succeeds (open 0); a refund on a cancelled invoice with a payment succeeds up to the paid amount.
  - reverse sets the three columns and open rises again; reverse twice fails `already_reversed`; reversing a write-off works.
  - transfer to an invoice of another customer, another org, the same invoice, or a draft fails `transfer_target_invalid`; a valid transfer leaves the source reversed and the new entry with `transferred_from`, same amount and `booked_on`, in one statement (simulate failure: target locked → nothing changed).
  - notices: invoice due Berlin today fails with blocker `not_overdue`; due yesterday succeeds with stage 1 and snapshot `open_amount` = 1090; active hold fails `on_hold`; expired hold (`until` yesterday) passes; stage 2 before stage 1 has `pdf_path` fails `previous_stage_open`; stage 4 fails `max_stage`; paid invoice fails `nothing_open`; cancelled invoice fails `not_issued`.
  - every RPC with an invoice of org B called by a producer of org A fails `forbidden`; a technician fails.
- [ ] **Step 2:** `supabase test db`. Expected: FAIL.
- [ ] **Step 3:** Write the migration. Blockers are collected in a fixed order (`not_issued, not_overdue, nothing_open, on_hold, previous_stage_open, max_stage`) and raised once with `detail`.
- [ ] **Step 4:** `npm run local:reset`, `supabase test db`. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank payment and dunning rpcs`.

### Task 3: Views and storage protection (R3, R4)

**Files:**
- Create: `supabase/migrations/20261008150000_werkbank_open_items_views.sql`
- Test: `supabase/tests/werkbank/open_items_views.test.sql`

**Interfaces:**
- Consumes: Task 2 helper `werkbank.invoice_open_amount`; `werkbank.invoice_list` for header columns.
- Produces: view `werkbank.invoice_balances` with columns `invoice_id, org_id, invoice_no, status, customer_id, property_id, customer_name, property_name, issue_date, due_date, claim, paid, written_off, open_amount, payment_state, days_overdue, last_stage, last_notice_date, hold_reason, hold_until`; view `werkbank.dunning_due` with all `invoice_balances` columns plus `next_stage, customer_invoice_email, contact_email, customer_email`; `werkbank.protect_invoice_files()` replaced (`create or replace`) to cover the second path segment `dunning` with message `dunning_locked`.

- [ ] **Step 1: Failing pgTAP:** `payment_state` for each case of spec R3 (open, partial, paid, written_off, overpaid, void, cancelled with a payment = overpaid with `claim` 0); cancellation invoices are absent; `days_overdue` 0 when not due and 3 when due 3 Berlin days ago; `dunning_due` includes an invoice 7 days past due with no notice (`next_stage` 1), excludes it at 6 days, includes stage 2 at 14 days after the reminder, excludes held, paid and stage-3 invoices, respects changed profile wait days; another org's rows invisible (`security_invoker`); storage: update and delete of `<org>/dunning/x.pdf` fail `dunning_locked`, `<org>/quotes/x.pdf` still deletable.
- [ ] **Step 2:** `supabase test db`. Expected: FAIL.
- [ ] **Step 3:** Write the migration.
- [ ] **Step 4:** `npm run local:reset`, `supabase test db`. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank open items views`.

### Task 4: Types, export, data layer and pure helpers

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerated, `--schema public,graphql_public,werkbank`), mirrors via `npm run sync:mirrors`
- Modify: `supabase/functions/export-org-data/index.ts` (+ its test): add the three tables
- Modify: `src/features/werkbank/lib/dbErrors.ts` (+ test), `src/features/werkbank/lib/money.ts` (+ test)
- Create: `src/features/werkbank/data/invoiceEntries.ts`, `src/features/werkbank/data/dunning.ts` (+ tests)
- Create: `src/features/werkbank/lib/paymentStatus.ts`, `src/features/werkbank/lib/defaultRecipient.ts`, `src/features/werkbank/lib/dunningDefaults.ts` (+ tests); manifest entries mirroring `defaultRecipient.ts` and `dunningDefaults.ts` to `supabase/functions/_shared/werkbank/`
- Modify: `src/features/werkbank/components/IssueInvoiceDialog.tsx:53` and `SendQuoteDialog.tsx` to use `defaultRecipient`

**Interfaces:**
- Produces:
  - `parseEuroInput(raw: string): number | null` in `money.ts`: accepts `1.190,50`, `1190,5`, `1190.50`; null for empty, non-numeric, more than two decimals, ≤ 0.
  - `DbErrorKey` additions `errors.entriesLocked`, `errors.dunningLocked`, `errors.notPayable`, `errors.futureBookingDate`, `errors.refundExceedsCredit`, `errors.nothingOpen`, `errors.openAmountChanged`, `errors.alreadyReversed`, `errors.transferTargetInvalid`, `errors.dunningNotAllowed`; `dunningBlockers(error): DunningBlocker[]` parses `detail`.
  - `type DunningBlocker = "not_issued" | "not_overdue" | "nothing_open" | "on_hold" | "previous_stage_open" | "max_stage"` exported from `dunningDefaults.ts`, plus `DUNNING_STAGE_TITLES: Record<1|2|3, string>` = `"Zahlungserinnerung"`, `"1. Mahnung"`, `"2. und letzte Mahnung"` and `DEFAULT_STAGE_TEXTS: Record<1|2|3, string>` (exact copy below) and `stageText(stage, profile): string` (profile column when not blank, else default).
  - `defaultRecipient(customer: { invoice_email?: string|null; email?: string|null } | null, contact: { email?: string|null } | null): string` (the rule now inline in `IssueInvoiceDialog.tsx:53`, empty string when none).
  - `paymentStatus(row: Pick<InvoiceBalance, "payment_state"|"days_overdue"|"last_stage">): { labelKey: string; tone: keyof typeof TONES }`: `overdue` label and amber when `days_overdue > 0` and `last_stage < 2`, red when `last_stage >= 2` and open; `paid`/`written_off`/`void` neutral success tones; `overpaid` info tone.
  - `invoiceEntries.ts`: types `InvoiceEntry`, `InvoiceBalance`, `EntryKind`, `WriteOffReason`; `fetchInvoiceBalance(client, orgId, invoiceId): Promise<InvoiceBalance | null>`, `fetchInvoiceEntries(client, orgId, invoiceId): Promise<InvoiceEntry[]>` (oldest first), `fetchOpenItems(client, orgId, q: { search: string; customerId?: string; overdueOnly?: boolean }): Promise<InvoiceBalance[]>` (`open_amount <> 0`, `fetchAllPages`, ordered `days_overdue desc`), `fetchCustomerCredit(client, orgId): Promise<number>`, `recordInvoiceEntry(client, input: { invoiceId: string; kind: EntryKind; amount: number; bookedOn: string; note?: string; writeOffReason?: WriteOffReason }): Promise<string>`, `reverseInvoiceEntry(client, entryId: string, reason: string): Promise<void>`, `transferInvoiceEntry(client, entryId: string, targetInvoiceId: string, reason: string): Promise<string>`, `fetchTransferTargets(client, orgId, customerId, excludeInvoiceId): Promise<InvoiceListRow[]>` (issued invoices of the customer, newest `issue_date` first, so a corrected copy leads).
  - `dunning.ts`: types `DunningNotice`, `DunningHold`, `DunningDueRow`; `fetchDunningNotices(client, orgId, invoiceId)`, `fetchDunningHold(client, orgId, invoiceId): Promise<DunningHold | null>`, `fetchDunningDue(client, orgId): Promise<DunningDueRow[]>`, `setDunningHold(client, invoiceId, reason, until: string | null)`, `clearDunningHold(client, invoiceId)`.

Default stage texts (exact, German, "Sie"; the PDF adds the amount and deadline sentence itself):

1. `sicher ist Ihnen im Alltag entgangen, dass die unten genannte Rechnung noch offen ist. Sollten Sie die Zahlung bereits veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos.`
2. `leider konnten wir zu der unten genannten Rechnung bis heute keinen vollständigen Zahlungseingang feststellen. Wir bitten Sie, den offenen Betrag nun umgehend zu begleichen.`
3. `trotz unserer bisherigen Schreiben ist die unten genannte Rechnung weiterhin offen. Dies ist unsere letzte Mahnung. Nach Ablauf der Frist behalten wir uns weitere Schritte vor, ohne Sie erneut zu benachrichtigen.`

- [ ] **Step 1: Failing Vitest:** `parseEuroInput` table (`"1.190,50"`→1190.5, `"1190,5"`→1190.5, `"12,345"`→null, `"-5"`→null, `""`→null); `mapDbError` for each new message; `dunningBlockers` on `{ message: "dunning_not_allowed", details: "not_overdue,on_hold" }` → `["not_overdue","on_hold"]`; `defaultRecipient` precedence and blank handling; `stageText` default vs profile vs whitespace; `paymentStatus` per state; data functions with `supabaseFake` (RPC names and argument names `p_invoice`, `p_kind`, `p_amount`, `p_booked_on`, `p_note`, `p_write_off_reason`, `p_entry`, `p_reason`, `p_target_invoice`, `p_until`; filters `org_id`, `open_amount neq 0`); `export-org-data` test lists the three tables.
- [ ] **Step 2:** `npx vitest run src/features/werkbank`. Expected: FAIL.
- [ ] **Step 3:** Regenerate types, implement, add manifest entries, `npm run sync:mirrors`, switch the two dialogs to `defaultRecipient`.
- [ ] **Step 4:** `npx vitest run src/features/werkbank supabase` and `deno test --allow-all supabase/functions/export-org-data`, `npm run sync:mirrors:check`. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank open items data layer`. Then `npm run verify:fast`, push, open PR 1 (base `main`).

## PR 2: Notices and sending (branch `feature/werkbank-teil5-dunning`, from PR 1)

### Task 5: Notice data and PDF (R6)

**Files:**
- Create: `supabase/functions/_shared/werkbank/pdf/dunningData.ts`, `supabase/functions/_shared/werkbank/pdf/dunningDocument.tsx`, tests `dunningData.test.ts`, `dunning.test.tsx`

**Interfaces:**
- Consumes: `SellerSnapshot`/`BuyerSnapshot` types and `formatDateDe` (Teil 4), `SellerHeader`, `PageFooter`, `money`, `s` from `pdf/quoteDocument.tsx`, `registerQuoteFonts`, `stageText`, `DUNNING_STAGE_TITLES` from the mirrored `dunningDefaults.ts`.
- Produces: `type DunningData = { stage: 1|2|3; title: string; noticeDate: string; paymentDeadline: string; invoice: { no: string; issueDate: string; dueDate: string; propertyName: string | null }; invoiceGross: number; paidAmount: number; openAmount: number; text: string; earlierNotices: { stage: 1|2|3; date: string }[]; seller: SellerSnapshot; buyer: BuyerSnapshot; draft: boolean }`; `buildDunningData(input: { notice: Pick<DunningNoticeRow, "stage"|"notice_date"|"payment_deadline"|"invoice_gross"|"paid_amount"|"open_amount">; invoice: InvoiceRow; propertyName: string | null; profile: CompanyProfileRow; earlier: Pick<DunningNoticeRow,"stage"|"notice_date">[]; draft: boolean }): DunningData`; `renderDunningPdf(data: DunningData, logoDataUrl?: string): Promise<Uint8Array>`.
- PDF content (spec R6): title; reference line `Rechnung RE-0012 vom 08.10.2026, Liegenschaft …`; salutation "Sehr geehrte Damen und Herren,"; the stage text; table Rechnungsbetrag / Bereits gezahlt / Offener Betrag / Ursprünglich fällig am; sentence `Bitte überweisen Sie den offenen Betrag von 1.090,00 € bis zum 15.10.2026 auf das unten genannte Konto.`; for stage ≥ 2 `Unsere Zahlungserinnerung vom … und unsere 1. Mahnung vom … blieben bisher ohne vollständige Zahlung.` (only the existing earlier stages); closing "Mit freundlichen Grüßen" and company name; footer with bank details; "ENTWURF" watermark when `draft`.

- [ ] **Step 1: Failing Deno tests:** `buildDunningData` for stage 1 without payment (title, text default, no earlier sentence), stage 2 with a partial payment and one earlier notice, stage 3 with a profile text; seller and buyer come from the invoice snapshots, not from the current profile (except the stage text); `renderDunningPdf` returns bytes starting `%PDF` and the extracted text contains the title, the open amount `1.090,00 €` and the deadline (pattern of `quote.test.tsx`).
- [ ] **Step 2:** `deno test --allow-all supabase/functions/_shared/werkbank/pdf`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank dunning notice pdf`.

### Task 6: `werkbank-dunning` preview, issue, download (R5)

**Files:**
- Create: `supabase/functions/werkbank-dunning/index.ts`, `index.test.ts`, `deno.json` (as `werkbank-invoices` minus the e-invoice dependency)
- Modify: `supabase/config.toml` (`[functions.werkbank-dunning]` `verify_jwt = true`)

**Interfaces:**
- Consumes: Task 5; `uploadDocument`/`signedUrl` from `_shared/werkbank/documentStorage.ts`; `requireOrgRole`, `resolveOrgKind`.
- Produces: `handle(req, deps, render: { pdf: typeof renderDunningPdf } = { pdf: renderDunningPdf })`. Request bodies: `{ action: "preview", org_id, invoice_id, payment_deadline? }`; `{ action: "issue", org_id, invoice_id, delivery: "email"|"print", payment_deadline, send?: { to?: string[]; cc?: string[] } }`; `{ action: "send", org_id, notice_id, to?: string[], cc?: string[] }`; `{ action: "download-url", org_id, notice_id }`. Responses: preview `application/pdf`; issue `{ notice_id, stage, sent?: boolean }`; download `{ url }`; errors `{ error, blockers?, issued? }`.
- Behaviour: `issue` first looks for a notice of this invoice with `pdf_path is null`; if found it renders and stores that one (resume), else calls `create_dunning_notice` with the caller's JWT client; `dunning_not_allowed` → 409 `{ error: "not_allowed", blockers }`; render or upload failure → 500 `{ error: "render_failed", issued: true }`. `payment_deadline` defaults to Berlin today + `dunning_deadline_days`.

- [ ] **Step 1: Failing Deno tests** (`makeFakeDeps`): wrong role 403, non-handwerk 403, unknown invoice 404; preview renders with `draft: true` and writes nothing; issue calls the RPC with `p_delivery`, `p_payment_deadline`, uploads to `<org>/dunning/<id>.pdf`, stamps `pdf_path` and `pdf_sha256` via the admin client; blocker detail → 409 with `blockers: ["nothing_open"]`; render throws → 500 `issued: true`, a second issue call does not call the RPC and stores the file; `print` never calls `sendEmail`; download-url returns a 60 s signed URL and 409 `pdf_missing` without a file.
- [ ] **Step 2:** `deno test --allow-all supabase/functions/werkbank-dunning`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun; `deno check --node-modules-dir=none supabase/functions/werkbank-dunning/index.ts`. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank-dunning edge function`.

### Task 7: Sending and the `dunning-sent` email (R5, R6)

**Files:**
- Create: `supabase/functions/_shared/werkbank/emails/dunning-sent.tsx`, `dunningEmail.test.tsx`
- Modify: `supabase/functions/_shared/transactional-email-templates/registry.ts`, `supabase/functions/werkbank-dunning/index.ts` (+ test)

**Interfaces:**
- Consumes: `checkRecipients`, `defaultRecipient` (mirrored), `invoice-sent.tsx` layout.
- Produces: template `dunning-sent` with props `{ companyName, stageTitle, invoiceNo, openAmount, paymentDeadline, message? }`; subject `${stageTitle} zu Rechnung ${invoiceNo}` (e.g. `1. Mahnung zu Rechnung RE-0012`); `send` action and `issue` with `send`.
- Behaviour: recipients are the request's `to` when given, else `defaultRecipient(customer, contact)` of the invoice; none → 409 `no_recipient`; downloads the stored notice and the stored invoice file (`invoices.pdf_path`), never renders; missing invoice file → 409 `invoice_file_missing`; attachments `Mahnung-RE-0012-1.pdf` and `Rechnung-RE-0012.pdf`; `reply_to` profile email; sets `sent_at`, `sent_to`; email failure after a stored notice → 502 `{ error: "send_failed", issued: true }`.

- [ ] **Step 1: Failing tests:** template renders subject and body per stage; send with explicit `to`; send without `to` uses the invoice email, else contact, else customer; no address → 409; two attachments with those names; invoice file missing → 409; email failure → 502 `issued: true` and `sent_at` unchanged; `issue` with `send: {}` stores then sends.
- [ ] **Step 2:** `deno test --allow-all supabase/functions/werkbank-dunning supabase/functions/_shared/werkbank/emails`. Expected: FAIL.
- [ ] **Step 3:** Implement and register the template.
- [ ] **Step 4:** Rerun; `deno check` on the function. Expected: PASS.
- [ ] **Step 5:** Commit `send werkbank dunning notices by email`. Then `npm run verify:fast`, push, open PR 2 (base PR 1 branch).

## PR 3: UI (branch `feature/werkbank-teil5-ui`, from PR 2)

### Task 8: Hooks, actions client and `DefaultHint`

**Files:**
- Create: `src/features/werkbank/hooks/useOpenItems.ts` (+ test), `src/features/werkbank/data/dunningActions.ts` (+ test), `src/features/werkbank/hooks/useDunningActions.ts`, `src/features/werkbank/components/DefaultHint.tsx` (+ test)
- Modify: `docs/ui-conventions.md` (rule: "A preset value carries a tooltip that explains it. Use `DefaultHint` in Werkbank."), `src/features/werkbank/i18n/{en,de}` namespace files

**Interfaces:**
- Consumes: Task 4 data functions; Task 6/7 request bodies.
- Produces: hooks `useInvoiceBalance(invoiceId)`, `useInvoiceEntries(invoiceId)`, `useOpenItems(q)`, `useDunningDue()`, `useDunningNotices(invoiceId)`, `useDunningHold(invoiceId)`, `useRecordEntry()`, `useReverseEntry()`, `useTransferEntry()`, `useSetDunningHold()`, `useClearDunningHold()`; `DunningActionError` (fields `code`, `blockers`, `issued`), `previewDunning`, `issueDunning(client, { orgId, invoiceId, delivery, paymentDeadline, send?: { to?: string[]; cc?: string[] } })`, `sendDunning`, `dunningDownloadUrl`; `<DefaultHint text={string} />` rendering a `CircleHelp` icon (`aria-label` = text) inside `IconTooltip`.

- [ ] **Step 1: Failing Vitest:** hooks call the data functions with the org id and the spec query keys; mutations invalidate `["werkbank","open-items"]` and `["werkbank","invoices"]`; `issueDunning` maps a 409 body `{ error: "not_allowed", blockers }` to `DunningActionError` and a 502 to `issued: true`; `DefaultHint` shows the text on hover and exposes it as accessible name.
- [ ] **Step 2:** `npx vitest run src/features/werkbank`. Expected: FAIL.
- [ ] **Step 3:** Implement; add the rule to `docs/ui-conventions.md`.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank open items hooks and default hint`.

### Task 9: Payments card on the invoice page

**Files:**
- Create: `src/features/werkbank/components/PaymentsCard.tsx`, `RecordEntryDialog.tsx`, `ReverseEntryDialog.tsx`, `TransferEntryDialog.tsx`, `src/features/werkbank/schemas/payment.ts` (+ tests)
- Modify: `src/features/werkbank/pages/InvoicePage.tsx` (+ test): render the card for `issued` and `cancelled` invoices of `type = 'invoice'`

**Interfaces:**
- Consumes: Task 8 hooks, `parseEuroInput`, `paymentStatus`, `mapDbError`, `DefaultHint`, `DatePopover`, `berlinDateKey`.
- Produces: `RecordEntryDialog` modes `payment | write_off | refund`. Payment presets: date = Berlin today, amount = open amount (`DefaultHint` on both); warning text when amount > open. Write-off: amount fixed to the open amount (read-only `Metric`), reason select, note required for `other`, hint "Betrifft nur die offenen Posten in Werkbank. Eine Umsatzsteuerkorrektur macht Dein Steuerberater." Refund: amount ≤ credit. On `open_amount_changed` the dialog refetches and shows `errors.openAmountChanged`.

- [ ] **Step 1: Failing Vitest:** card shows claim, paid, written off, open for a partial invoice and "Guthaben" for an overpaid one; reversed entries render struck through with reason; payment dialog presets today (fake timers at `2026-10-08T22:30:00Z` → `2026-10-09`) and the open amount; `"1.190,50"` submits 1190.5; `"12,345"` shows a field error and does not submit; amount above open shows the warning and still submits; write-off submits the open amount and requires a note for `other`; `open_amount_changed` shows the message and refetches; refund button only with credit; transfer dialog lists only issued invoices of the same customer and submits the reason; cancelled invoice with credit shows the transfer notice.
- [ ] **Step 2:** `npx vitest run src/features/werkbank`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add payments card to werkbank invoices`.

### Task 10: Dunning card, notice dialog and hold

**Files:**
- Create: `src/features/werkbank/components/DunningCard.tsx`, `CreateDunningDialog.tsx`, `DunningHoldDialog.tsx` (+ tests)
- Modify: `src/features/werkbank/pages/InvoicePage.tsx` (+ test)

**Interfaces:**
- Consumes: Task 8 hooks and actions, `defaultRecipient`, `DUNNING_STAGE_TITLES`, `DefaultHint`.
- Produces: card lists notices (stage title, date, deadline, delivery, recipients, PDF via `dunningDownloadUrl`, "Erneut senden" for `email`); the create button label follows the next stage ("Zahlungserinnerung erstellen" / "1. Mahnung erstellen" / "2. Mahnung erstellen") and is disabled with a tooltip naming the client-side blocker (derived from balance, hold and notices with the same names as SQL); dialog fields recipient (preset `defaultRecipient`, `DefaultHint`), CC, deadline (preset today + `dunning_deadline_days`, `DefaultHint`), buttons Vorschau, "Erstellen und senden", "Nur PDF für Postversand"; hold dialog with reason and optional until date (`DefaultHint`: "Ohne Datum gilt die Sperre, bis Du sie aufhebst."); active hold banner with "Aufheben".

- [ ] **Step 1: Failing Vitest:** no create button for a paid invoice; disabled with `not_overdue` tooltip before the due date; next stage label after one notice; dialog presets recipient and deadline; "Nur PDF" calls `issueDunning` with `delivery: "print"` and no `send`; send failure (502) shows "Erstellt, Versand fehlgeschlagen" with Erneut senden; server blockers are listed; hold banner and clear; cancelled invoice shows notices read-only without create button.
- [ ] **Step 2:** `npx vitest run src/features/werkbank`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add dunning card to werkbank invoices`.

### Task 11: Open items page, nav, mini and invoices list

**Files:**
- Create: `src/features/werkbank/pages/OpenItemsPage.tsx` (+ test), `src/features/werkbank/components/BulkDunningDialog.tsx` (+ test), `src/lib/minis/pages/openItems.ts`, `src/components/minis/illustrations/OpenItemsMini.tsx`
- Modify: `src/features/werkbank/paths.ts` (`OPEN_ITEMS_PATH = "/open-items"`), `src/features/werkbank/ui.ts` (+ test: nav item after Rechnungen, `handwerk`, admin and producer, route), `src/lib/minis/index.ts`, `src/components/minis/illustrations/index.ts`, `src/features/werkbank/pages/InvoicesPage.tsx` (+ test), `src/features/werkbank/data/invoices.ts` (`InvoiceFilter` gains `"overdue"`; list joins `invoice_balances` columns `open_amount`, `payment_state`, `days_overdue`, `last_stage`)

**Interfaces:**
- Consumes: Task 8 hooks and actions, `paymentStatus`.
- Produces: page with three `KpiTile`s (sum open > 0, sum open of `days_overdue > 0`, credit), `SegmentedControl` `open | due`; bulk flow: confirm dialog listing count and recipients, rows without any address excluded and named; sequential `issueDunning(..., { delivery: "email", send: {} })`; result summary counts `sent`, `skipped` (409 `not_allowed`), `failed` (other errors) with links to the failed invoices; rows without address offer single "PDF für Postversand".

- [ ] **Step 1: Failing Vitest:** open view sorts by days overdue, shows hold icon with reason tooltip, credit as negative `Metric`, `EmptyState` with nothing open; due view selection and bulk send with one `nothing_open` (skipped) and one 500 (failed) → summary "1 versendet, 1 übersprungen, 1 fehlgeschlagen"; invoices list renamed filter `Ausgestellt`, new `Überfällig`, columns Zahlstatus and Offen; `ui.test.ts` nav order; `minis.test.ts` passes for the new mini.
- [ ] **Step 2:** `npx vitest run src/features/werkbank src/lib/minis src/i18n`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank open items page`.

### Task 12: Customer section, settings and dashboard

**Files:**
- Modify: `src/features/werkbank/pages/CustomerDetailPage.tsx`, `src/features/werkbank/components/CompanyTab.tsx`, `src/features/werkbank/data/companyProfile.ts`, `src/features/werkbank/components/WerkbankDashboard.tsx`, `src/features/werkbank/data/startList.ts`, `src/features/werkbank/components/StartList.tsx` (+ their tests)

**Interfaces:**
- Consumes: `fetchOpenItems` with `customerId`, `stageText`, `DEFAULT_STAGE_TEXTS`.
- Produces: customer section "Offene Posten" (sum open, credit, rows linking to invoices, hidden when empty); `CompanyTab` section "Mahnwesen" with the four day fields (`DefaultHint` each, naming the default) and three textareas (placeholder = default text, `DefaultHint`: "Leer lassen für den Standardtext."); dashboard `KpiTile` "Überfällig" (value overdue count, caption "davon n mahnfällig", link to `/open-items`); start list step `first_payment` "Erste Zahlung erfassen", done when any entry of kind `payment` exists.

- [ ] **Step 1: Failing Vitest:** customer section numbers; settings save the seven columns and reject 366; dashboard tile counts; start list step done state.
- [ ] **Step 2:** `npx vitest run src/features/werkbank`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS.
- [ ] **Step 5:** Commit `add open items to customers, settings and dashboard`.

### Task 13: `DefaultHint` retrofit for Teil 2 to 4 (R8)

**Files:**
- Modify (+ tests where a test file exists): `CompanyTab.tsx` (payment term days, invoice intro and closing, quote texts), `InvoiceHeaderForm.tsx` (payment term days, prefilled texts, service date from the order), `QuoteHeaderForm.tsx`, `OrderHeaderForm.tsx` (prefilled texts), `NumberingTab.tsx` (start values), `IssueInvoiceDialog.tsx`, `SendQuoteDialog.tsx` (recipient)

**Interfaces:**
- Consumes: `DefaultHint`.
- Produces: one `DefaultHint` per preset field; copy keys under `werkbank:hints.*`, one key per field, EN and DE.

- [ ] **Step 1: Failing Vitest:** for each listed component, the hint is present next to the preset field (query by accessible name).
- [ ] **Step 2:** `npx vitest run src/features/werkbank src/i18n`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rerun. Expected: PASS incl. `keyParity`, `copyLint`, `vocabularyLint`.
- [ ] **Step 5:** Commit `explain preset values in werkbank forms`.

### Task 14: Terms, help, changelog, end to end

**Files:**
- Modify: `src/i18n/terms.ts` (Offener Posten, Zahlungserinnerung, Mahnung, Mahnsperre, Ausbuchen, Guthaben, Zahlstatus), `src/lib/help/items.ts` (EN + DE items: record a payment, write off a remainder, transfer a payment, send a notice, hold a notice), `public/changelog.md` + `scripts/changelog-to-json.ts` run, `package.json` and `src/config/app.config.ts` version bump (MINOR)
- Create: `e2e/werkbank-open-items.spec.ts`

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write the Playwright spec** (pattern of `e2e/werkbank-invoices.spec.ts`, service role as oracle): issue invoice A (`Nur abschließen`), record a partial payment of 100,00, write off the rest with reason Skonto (`invoice_balances.payment_state = 'written_off'`); issue invoice B, record its full amount, cancel B, issue the cancellation and the corrected copy, transfer the payment to the copy (B `overpaid` → transfer → copy `paid`, B `void`); on invoice A before the transfer step set a hold and see the banner, then clear it; the create-notice button on a not yet due invoice is disabled with the "noch nicht fällig" tooltip. The overdue notice path is not in e2e: no client can backdate an issued invoice (the lock trigger allows neither the service role nor PostgREST to change `due_date`, and the e2e helpers have no superuser connection); pgTAP (Task 2, 3), Deno (Task 6, 7) and Vitest (Task 10, 11) cover it.
- [ ] **Step 2:** `npm run local:up`, `npx playwright test --config=e2e/playwright.config.ts e2e/werkbank-open-items.spec.ts`. Expected: PASS.
- [ ] **Step 3:** Help, terms, changelog (`## X.Y.Z — Oct 8, 2026`, theme, `### New` bullets for open items, payments, notices), regenerate JSON, bump version in both places.
- [ ] **Step 4:** `npm run verify:full`. Expected: PASS.
- [ ] **Step 5:** Commit `add werkbank open items help and e2e`. Push, open PR 3 (base PR 2 branch); description states the help center impact and the page mini.
