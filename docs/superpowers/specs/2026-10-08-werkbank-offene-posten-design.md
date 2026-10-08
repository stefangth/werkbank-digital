# Werkbank Teil 5: Open items and dunning (Offene Posten, Mahnwesen). Spec

**Date:** 2026-10-08
**Status:** Draft, awaiting owner review.
**Decision records:** [ADR-0014](../../adr/0014-werkbank-as-separate-fork.md) (separate fork; the ADR-0013 isolation rules still hold), [ADR-0013](../../adr/0013-werkbank-as-removable-module.md) (roadmap row 5).
**Builds on:** `2026-10-08-werkbank-rechnung-design.md` (Teil 4: `invoices`, `document_totals`, `werkbank-invoices`, `invoice-sent`, the storage immutability trigger, `company_profiles`).

---

## Problem

After Teil 4 the pilot business issues and sends invoices from Werkbank, but it cannot see which of them are paid. Incoming payments are tracked in the bank account or a spreadsheet, overdue invoices are found by hand, and reminders are written in a word processor. Its customers are mostly property managers, who often pay late, pay in parts, deduct small amounts, or pay twice.

**Success:** a payment is recorded in under 10 seconds. The overdue invoices are visible without searching. A reminder is created and sent as a PDF and email in two clicks, one at a time or for a selection. Small remainders and overpayments can be resolved without cancelling an invoice.

## Decision summary (locked with the owner, 2026-10-08)

| Question | Decision |
|---|---|
| Payment input | Manual only. No bank statement import, no bank API |
| Partial payments | Yes |
| Dunning levels | Three: Zahlungserinnerung, 1. Mahnung, 2. und letzte Mahnung |
| Trigger | The office sends; Werkbank lists what is due. No automatic sending, no cron |
| Fees and interest | None. A notice states only the open invoice amount |
| Remainders | "Rest ausbuchen" with a mandatory reason; reversible |
| Wrong entries | Reversed with a reason, never deleted; stay visible struck through |
| Notice scope | One notice per invoice, each invoice runs its own levels |
| Notice form | PDF letter, stored immutably; email attaches the notice and the original invoice PDF; "PDF only" for postal delivery |
| Overpayment | Allowed after a warning; shown as credit; "Zahlung umbuchen" moves a payment to another invoice of the same customer; refunds are recorded, never executed |
| Dunning hold | Yes, per invoice, with reason and optional end date |
| Defaults | Wait days 7 / 14 / 14, notice payment deadline 7 days, all configurable |
| Data model | Entries per invoice, balances as a view (Approach A) |
| Default values in the UI | Every preset value gets a tooltip that explains it (owner rule, applies to Teil 2 to 4 fields too) |

## Non-goals

- Bank statement import (CSV, CAMT.053), bank APIs (FinTS, PSD2), automatic matching.
- Dunning fees, the §288 BGB lump sum, default interest.
- Automatic dunning, notifications, cron jobs.
- Collective notices per customer; several notices bundled in one email.
- Handover to debt collection or court (Mahnbescheid).
- A customer ledger (Kontokorrent) with signed bookings; DATEV export (post-V1).
- Executing refunds or any money movement.
- VAT corrections for bad debts (the tax adviser's job; the UI says so).
- English notices or emails; both are German in V1.
- A navigation badge: `NavBadge` in `src/components/layout/navItems.ts` is a core type with Showflow counters; a Werkbank counter there would cross the module boundary. The dashboard tile carries the count instead.
- Removing the Showflow domain (separate spec per ADR-0014).

## Reuse map

| Need | Existing piece | Use |
|---|---|---|
| Invoice amount | View `werkbank.document_totals` (invoice branch) | `gross_total` is the claim; no VAT arithmetic anywhere else |
| Invoice header, status, due date | `werkbank.invoices` (Teil 4) | Read only; nothing in Teil 5 writes to it |
| RPC conventions | `finalize_invoice`, `cancel_invoice` (security definer, `set search_path = ''`, role check, row lock, SQLSTATE messages) | Same shape for the new RPCs |
| Error mapping | `src/features/werkbank/lib/dbErrors.ts` (`mapDbError`) | New codes mapped to German and English copy |
| PDF on the edge | `_shared/werkbank/pdf/fonts.ts`, `einvoice/invoiceDocument.tsx` (letterhead, footer, layout) | Notice document in the same style; letterhead parts extracted if needed, not copied |
| Stored invoice file | `invoices.pdf_path`, `_shared/werkbank/documentStorage.ts` | Downloaded and attached to the notice email |
| Edge scaffolding | `werkbank-invoices/index.ts` (`handle(req, deps)`, `requireOrgRole`, `resolveOrgKind`, resume logic, 502 with `issued: true`) | Same structure in `werkbank-dunning` |
| Recipients | `_shared/werkbank/recipients.ts` | Same resolution as for invoices |
| Email | `send-transactional-email` (2 attachments, 5 MB, `reply_to`), `_shared/werkbank/emails/invoice-sent.tsx` | One new template `dunning-sent` |
| File immutability | `werkbank.protect_invoice_files()` on `storage.objects` | Extended to the `dunning` folder |
| Settings | `werkbank.company_profiles`, `CompanyTab.tsx` | New columns and a "Mahnwesen" section |
| Lists, pages | `InvoicesPage`, `InvoicePage`, `CustomerDetailPage`, `fetchAllPages`, `invoiceStatus.ts`, `useDebouncedValue` | Same patterns; new page `OpenItemsPage` |
| UI primitives | `PageHeader`, `KpiTile`, `StatusPill`, `TONES`, `Metric`, `Token`, `EmptyState`, `SegmentedControl`, `Checkbox`, `money.ts`, `src/lib/dates.ts` | Reused |
| Tooltips | `src/components/common/IconTooltip.tsx` | Base of the new `DefaultHint` |

## Requirements

### R1. Tables (schema `werkbank`)

All conventions of Teil 2 to 4 apply: `org_id ... on delete cascade`, composite foreign keys over `(org_id, id)`, RLS enabled, admin and producer of the org read. **The three new tables are select-only for `authenticated`; every write goes through the RPCs in R2.** No `updated_at` on `invoice_entries` and `dunning_notices` (they do not change except for the fields named below).

**`werkbank.invoice_entries`**

| Column | Type and rule |
|---|---|
| `invoice_id` | `uuid not null`, composite FK to invoices, `on delete no action` |
| `kind` | `text not null check (in ('payment','refund','write_off'))` |
| `amount` | `numeric(12,2) not null check (amount > 0)` |
| `booked_on` | `date not null`; not after the Berlin date of the insert (checked in the RPC) |
| `write_off_reason` | `text check (in ('skonto','goodwill','bad_debt','other'))`; `check ((kind = 'write_off') = (write_off_reason is not null))` |
| `note` | `text`; required when `write_off_reason = 'other'` (check) |
| `transferred_from` | `uuid unique`, composite FK to `invoice_entries`; set only by the transfer RPC |
| `reversed_at`, `reversed_by`, `reversal_reason` | `timestamptz`, `uuid`, `text`; all null or all set (check); `reversal_reason` not blank |
| `created_by`, `created_at` | `uuid not null`, `timestamptz not null default now()` |

A trigger rejects every delete and every update except setting the three reversal columns once, from null, inside `reverse_invoice_entry` or `transfer_invoice_entry` (transaction-local setting, as the order status guard in Teil 4).

Indexes: `(org_id)`, `(invoice_id)`.

**`werkbank.dunning_notices`**

| Column | Type and rule |
|---|---|
| `invoice_id` | `uuid not null`, composite FK to invoices, `on delete no action` |
| `stage` | `smallint not null check (between 1 and 3)`; `unique (invoice_id, stage)` |
| `notice_date` | `date not null` (Berlin today at creation) |
| `payment_deadline` | `date not null check (payment_deadline >= notice_date)` |
| `invoice_gross`, `paid_amount`, `open_amount` | `numeric(12,2) not null`, snapshot at creation; `open_amount > 0` |
| `delivery` | `text not null check (in ('email','print'))` |
| `pdf_path`, `pdf_sha256` | `text`, set once by the service role |
| `sent_at`, `sent_to` | `timestamptz`, `text[]`; updated on every email send |
| `created_by`, `created_at` | as above |

A lock trigger allows only the service role to set `pdf_path`/`pdf_sha256` once (from null) and to update `sent_at`/`sent_to`; every other update and every delete is rejected.

Indexes: `(org_id)`, `(invoice_id)` is covered by the unique constraint.

**`werkbank.dunning_holds`**

| Column | Type and rule |
|---|---|
| `invoice_id` | `uuid primary key`, composite FK to invoices, `on delete cascade` |
| `reason` | `text not null`, not blank |
| `until` | `date`, optional; a hold with a past `until` no longer counts |
| `created_by`, `created_at` | as above |

Written through `set_dunning_hold` and `clear_dunning_hold`. Lifting a hold deletes the row (a hold is a working note, not a business record).

**`werkbank.company_profiles`:** new columns, each `not null` with a default and a range check `between 0 and 365`: `reminder_after_days` (7, days after the due date), `dunning1_after_days` (14, after the reminder), `dunning2_after_days` (14, after the first notice), `dunning_deadline_days` (7, payment deadline stated in a notice). New text columns `reminder_text`, `dunning1_text`, `dunning2_text` (null means the default text from the code).

### R2. RPCs

All `security definer`, `set search_path = ''`, role check admin or producer of the invoice's org, `revoke all ... from public, anon`, `grant execute ... to authenticated`. Each locks the invoice row (`for update`) first, so concurrent calls on one invoice run one after the other. Errors use distinct messages that `mapDbError` maps.

- `record_invoice_entry(p_invoice uuid, p_kind text, p_amount numeric, p_booked_on date, p_note text, p_write_off_reason text) returns uuid`
  - `payment`: invoice `type = 'invoice'` and `status = 'issued'`. Any positive amount; above the open amount is allowed (the UI warns).
  - `refund`: invoice `type = 'invoice'`, `status` issued or cancelled; amount at most the current credit.
  - `write_off`: invoice `status = 'issued'` with open amount > 0. `p_amount` must equal the current open amount (the RPC recomputes it; a stale client value fails with `open_amount_changed`). Reason required.
  - `booked_on` not after Berlin today.
- `reverse_invoice_entry(p_entry uuid, p_reason text) returns void`: sets the reversal columns once. Fails if already reversed.
- `transfer_invoice_entry(p_entry uuid, p_target_invoice uuid, p_reason text) returns uuid`: only a non-reversed `payment`; target is an issued `invoice` of the same org and customer, not the same invoice. Reverses the entry and inserts a new `payment` with the same amount and `booked_on` and `transferred_from` set, in one transaction.
- `create_dunning_notice(p_invoice uuid, p_delivery text, p_payment_deadline date) returns werkbank.dunning_notices`: invoice `type = 'invoice'`, `status = 'issued'`, `due_date < ` Berlin today, open amount > 0, no active hold, stage = highest existing stage + 1 and at most 3, and the previous stage has a stored file and, if its delivery is `email`, a `sent_at`. The wait days are not enforced here; they only drive `dunning_due`. Snapshots the amounts from `invoice_balances`.
- `set_dunning_hold(p_invoice uuid, p_reason text, p_until date) returns void` (upsert) and `clear_dunning_hold(p_invoice uuid) returns void`.

### R3. Views

Both `security_invoker = true`.

**`werkbank.invoice_balances`**, one row per invoice of `type = 'invoice'` with `status in ('issued','cancelled')`:

- `claim` = `gross_total` from `document_totals` for an issued invoice, 0 for a cancelled one (the cancellation invoice offsets it; cancellation invoices never appear in this view).
- `paid` = sum of non-reversed `payment` minus non-reversed `refund`.
- `written_off` = sum of non-reversed `write_off`.
- `open_amount` = `claim - paid - written_off` (negative means credit).
- `payment_state`: `open` (open > 0, paid = 0), `partial` (open > 0, paid > 0), `paid` (open = 0, written_off = 0), `written_off` (open = 0, written_off > 0), `overpaid` (open < 0), `void` (cancelled, open = 0).
- `days_overdue` = Berlin today minus `due_date` when open > 0 and positive, else 0.
- `last_stage`, `last_notice_date` from `dunning_notices`; `hold_reason`, `hold_until` from an active hold.
- Header fields for lists: invoice number, dates, customer and property names (as `invoice_list`).

**`werkbank.dunning_due`**: rows of `invoice_balances` with `status = 'issued'`, open > 0, no active hold, `last_stage < 3`, and Berlin today ≥ (due date + `reminder_after_days`) for stage 1, (last notice date + `dunning1_after_days`) for stage 2, (last notice date + `dunning2_after_days`) for stage 3. Adds `next_stage` and the raw addresses `customer_invoice_email`, `contact_email`, `customer_email`; the recipient rule itself lives in code (R6), not in SQL.

The pure function `paymentStatus()` in `src/features/werkbank/lib/paymentStatus.ts` turns `payment_state`, `days_overdue` and `last_stage` into a label key and a tone from `TONES` (amber when overdue, red from stage 2).

### R4. Storage

Notice files go to `werkbank-documents` at `<org_id>/dunning/<notice_id>.pdf`, written only by the service role. `werkbank.protect_invoice_files()` also protects the second path segment `dunning` (new migration with `create or replace`; the trigger stays). The error message for a notice file is `dunning_locked`.

### R5. Edge function `werkbank-dunning`

A new function, not an extension of `werkbank-invoices`: that bundle is close to the upload limit because of the vendored e-invoice build (#19), and notices need no XML. Structure as `werkbank-invoices`: `handle(req, deps)` plus `Deno.serve`, `requireOrgRole(org_id, ['admin','producer'])`, handwerk gate via `resolveOrgKind`, `[functions.werkbank-dunning]` in `config.toml` with `verify_jwt = true`.

| Action | Behaviour |
|---|---|
| `preview` | Renders the next stage with an "ENTWURF" watermark from current data; stores nothing |
| `issue` | Calls `create_dunning_notice` with the caller's JWT client, renders, stores, stamps `pdf_path`/`pdf_sha256`. With `send: true` continues with `send`. If a notice of the next stage exists without `pdf_path`, it skips the RPC and only renders (resume) |
| `send` | Requires a stored notice and a stored invoice file; sends both via `send-transactional-email` (template `dunning-sent`, `reply_to` = profile email), then sets `sent_at` and `sent_to`. Never re-renders |
| `download-url` | Signed URL (60 s) to the stored notice |

Error contract as in Teil 4: `{ error: code }` with 400/403/404/409/500; a send failure after a stored notice returns 502 with `issued: true`. A missing invoice file returns 409 `invoice_file_missing`.

### R6. Notice document and email

- **`_shared/werkbank/pdf/dunningData.ts`** (pure): builds the notice data from the notice row, the invoice, its seller and buyer snapshots and earlier notices. No arithmetic beyond what the snapshot holds.
- **`_shared/werkbank/pdf/dunningDocument.tsx`**: letterhead, fonts and footer of the invoice document. Title per stage ("Zahlungserinnerung", "1. Mahnung", "2. und letzte Mahnung"); reference to invoice number, invoice date and property; a small table with invoice amount, already paid, open amount and original due date; the stage text (profile or default); the new payment deadline as a date; bank details; for stages 2 and 3 a sentence naming the dates of the earlier notices. German, "Sie". All fonts embedded.
- **`dunning-sent`** template in `_shared/werkbank/emails/`, registered in the transactional template registry, German, "Sie", modelled on `invoice-sent.tsx`. Subject per stage, e.g. "1. Mahnung zu Rechnung RE-0012". Body with open amount and deadline. Attachments: the notice PDF and the original invoice PDF.
- **Recipient:** as for invoices: the customer's invoice email, else the contact's, else the customer's. On the server `recipients.ts` resolves it when the request carries no `to` (bulk send). In the client the inline rule of `IssueInvoiceDialog.tsx` moves to `src/features/werkbank/lib/defaultRecipient.ts`, used by the invoice dialog, the notice dialog and the bulk confirm dialog. Optional CC.
- **`export-org-data`:** exports `invoice_entries`, `dunning_notices`, `dunning_holds`.

### R7. Pages and navigation

New nav item **Offene Posten** (`/open-items`, path constant in `src/features/werkbank/paths.ts`) in `src/features/werkbank/ui.ts`, after Rechnungen, kinds `handwerk`, admin and producer.

- **Open items page (`OpenItemsPage`):** `PageHeader`; three `KpiTile`s (open total, of which overdue, customer credit); `SegmentedControl` **Offen** / **Mahnfällig**.
  - *Offen:* all rows of `invoice_balances` with open ≠ 0. Columns: Nr. (`Token`), Kunde / Liegenschaft, Fällig am, Tage überfällig, Offen (`Metric`, credit shown as negative), Zahlstatus (`StatusPill`), Mahnstufe, hold icon with the reason as tooltip. Sorted by days overdue, debounced search. `EmptyState` when nothing is open.
  - *Mahnfällig:* rows of `dunning_due` with checkboxes and the next stage. "Ausgewählte mahnen" opens a confirm dialog (count, recipients, rows without email listed and excluded). On confirm the client calls `issue` with `send: true` for each selected invoice one after another, shows progress, and ends with a summary ("12 versendet, 1 fehlgeschlagen") linking the failures. Rows without a recipient email offer only the single "PDF für Postversand" action.
- **Invoices list:** new columns Zahlstatus and Offen. The Teil 4 filter "Offen" (meaning issued) is renamed **Ausgestellt**; new filter **Überfällig**.
- **Invoice page, issued or cancelled invoice:**
  - Card **Zahlungen:** invoice amount, paid, written off, open or credit; the entries (date, kind, amount, note; reversed ones struck through with reason and a link to the transfer target). Actions: **Zahlung erfassen** (date preset to today, amount preset to the open amount; warning above the open amount), **Rest ausbuchen** (reason select, note), **Rückzahlung erfassen** (only with credit). Per entry: **Stornieren** (reason required), **Umbuchen** (target select of issued invoices of the same customer, newest first, so a corrected copy leads).
  - Card **Mahnungen:** sent stages with date, deadline, recipient, PDF, Erneut senden. Action "Zahlungserinnerung erstellen" / "1. Mahnung erstellen" / "2. Mahnung erstellen" (only when R2 allows it; otherwise the button is disabled with a tooltip naming the reason). Dialog: recipient, CC, payment deadline (preset), Vorschau, "Erstellen und senden", "Nur PDF für Postversand". **Mahnsperre setzen / aufheben** (reason, optional end date); an active hold shows as a banner on the card.
  - Cancelled invoice with credit: notice "Guthaben 1.190,00 €. Zahlung auf die korrigierte Rechnung umbuchen?" opening the transfer dialog.
- **Customer detail page:** section **Offene Posten** with open total, credit and the open invoices.
- **Settings, Firma (`CompanyTab`):** section **Mahnwesen** with the three wait days, the notice deadline and the three stage texts (placeholder shows the default text).
- **Dashboard:** `StartList` step "Erste Zahlung erfassen"; a `KpiTile` "Überfällig" whose value is the number of overdue invoices and whose caption names how many are due for a notice, linking to the open items page.
- **Copy:** `werkbank` namespace, Du in the app, Sie in PDF and email. New terms in `src/i18n/terms.ts` (Offener Posten, Zahlungserinnerung, Mahnung, Mahnsperre, Ausbuchen, Guthaben, Zahlstatus). Help items (EN + DE) for recording a payment, writing off, transferring, dunning and holds. Page mini for `/open-items` (`src/lib/minis/pages/openItems.ts`, illustration `OpenItemsMini.tsx`).

### R8. Default value tooltips

- New component `DefaultHint` (`src/features/werkbank/components/DefaultHint.tsx`): a `CircleHelp` icon placed after a field label, built on `IconTooltip`. The text says what the default is, where it comes from and whether it can be changed here, e.g. "Vorgabe 7 Tage. Kommt aus Einstellungen, Firma, Mahnwesen. Du kannst sie hier für diese Mahnung ändern."
- **Teil 5 fields:** the four day settings, the stage texts, the payment date and amount in "Zahlung erfassen", the notice recipient, the notice deadline, a hold without end date.
- **Retrofit (Teil 2 to 4):** every prefilled or preset field in the existing Werkbank forms, at least: payment term days (company profile and invoice), invoice intro and closing texts and their quote and order counterparts, the numbering start values, the invoice service date prefilled from the order, the invoice and quote recipient.
- `docs/ui-conventions.md` gains the rule: "A preset value carries a tooltip that explains it." Copy in the `werkbank` namespace (EN + DE, Du).

## Testing

Tests first (CLAUDE.md).

- **pgTAP (`supabase/tests/werkbank/`):** direct insert, update and delete on the three tables are rejected for `authenticated`, admins included; an entry can be reversed once and only through the RPCs; payment on a draft or a cancellation invoice fails; `booked_on` in the future fails; write-off equals the open amount and fails with nothing open or a stale amount; refund above credit fails; transfer to another customer, org or the same invoice fails and is atomic; `invoice_balances` gives the right state for open, partial, paid, written off, overpaid, void, cancelled with credit and cancellation after a partial payment; notices only in order, only overdue, not under an active hold, not without an open amount, unique per stage; an expired hold no longer blocks; `dunning_due` honours the wait days and stops after stage 3; concurrent write-offs or same-stage notices serialize on the row lock; the storage trigger blocks update and delete under `dunning/`; another org's invoice is rejected in every RPC; the isolation test picks up RLS and grants of the new tables.
- **Deno:** `dunningData` and `dunningDocument` per stage, with and without partial payment, with earlier notices; `dunning-sent` per stage; handler tests for each action, including resume after a render failure, send failure (502, `issued: true`), print delivery, missing invoice file, wrong role, non-handwerk org.
- **Vitest:** data-access functions (`invoiceEntries.ts`, `dunning.ts`) with `supabaseFake`; `paymentStatus`; `DefaultHint`; the open items page in both views including bulk send with one failure; the payments and dunning cards in every state (open, partial, overpaid, cancelled with credit, hold active, stage 3 reached); the renamed and new invoice list filters; the settings section.
- **Playwright (`e2e/werkbank-open-items.spec.ts`):** issue an invoice, record a partial payment, set and clear a hold, see the notice button disabled before the due date, write off the rest; pay a second invoice, cancel it, issue the corrected copy, transfer the payment; both invoices end settled. The overdue notice path stays out of e2e because no client can backdate an issued invoice (the lock trigger blocks `due_date` for PostgREST and the service role); pgTAP, Deno and Vitest cover it.

## Delivery

Three stacked PRs (owner rule: at most three per Teil), migrations applied by the Supabase GitHub integration on merge:

1. **Foundation:** migrations (R1 to R4), RPCs, views, pgTAP, regenerated types, `export-org-data`, data access, `paymentStatus`, `mapDbError` codes.
2. **Notices and sending:** R5 and R6, `config.toml` entry, Deno tests.
3. **UI:** R7 and R8 including the retrofit and the `ui-conventions.md` rule, help, page mini, Playwright.
