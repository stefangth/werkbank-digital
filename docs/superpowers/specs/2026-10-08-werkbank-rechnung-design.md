# Werkbank Teil 4: Invoices (Rechnung, ZUGFeRD, GoBD). Spec

**Date:** 2026-10-08
**Status:** Draft, awaiting owner review.
**Decision records:** [ADR-0014](../../adr/0014-werkbank-as-separate-fork.md) (separate fork; the ADR-0013 isolation rules still hold), [ADR-0013](../../adr/0013-werkbank-as-removable-module.md) (roadmap row 4, the e-invoicing spike).
**Builds on:** `2026-10-07-werkbank-stammdaten-design.md` (Teil 2) and `2026-10-07-werkbank-angebot-auftrag-design.md` (Teil 3: quotes, orders, `document_items`, `document_totals`, company profile, `werkbank-quotes`).

---

## Problem

After Teil 3 the pilot business writes quotes and runs orders in Werkbank, but it still writes invoices elsewhere. Its customers are mostly property managers (B2B), who must receive machine-readable e-invoices (EN 16931). Invoices are also subject to GoBD: once issued they cannot change, numbers have no gaps, and corrections happen only through a new document.

**Success:** when an order is done, the office creates the invoice with one click, checks it, and issues and sends it as a ZUGFeRD PDF in under a minute. A wrong invoice is cancelled with a cancellation invoice and reissued as a corrected copy. An invoice without an order is just as quick. Every issued file passes the Mustang validator.

## Decision summary (locked with the owner, 2026-10-08)

| Question | Decision |
|---|---|
| Invoice types | Final invoice only. No deposit or partial invoices |
| Source | From a done order, or a free invoice without an order |
| Format | ZUGFeRD / Factur-X profile EN 16931 (PDF/A-3 with embedded XML). No standalone XRechnung |
| GoBD | Yes: lock on issue, gapless numbers, correction only by cancellation |
| Buyer reference / Leitweg-ID | No |
| Correction | Cancellation only (full reversal). No partial credit note |
| Order rule | Invoice only from `done`; at most one active invoice per order; issuing sets the order to `invoiced` (locked); cancelling sets it back to `done` |
| Payment terms | Payment term in days (profile default, per invoice override) and a due date. No cash discount (Skonto) |
| Tax cases | Only the item VAT rates 19, 7, 0. No reverse charge (§13b) |
| Data model | Header table `invoices`; items in the existing `document_items` (Approach 1) |
| Numbering | One range `invoice` (`RE-`) for invoices and cancellations, assigned at issue in the same transaction |

## Non-goals

- Deposit, partial and progress invoices; partial credit notes.
- Cash discount, reverse charge (§13b), small-business rule (§19), foreign currencies.
- Buyer reference / Leitweg-ID, standalone XRechnung XML, Peppol delivery.
- Paid status, open items, dunning (Teil 5). DATEV export (post-V1).
- English invoices or emails; both are German in V1.
- A Werkbank sender domain (go-live item). The existing sender is used, as in Teil 3.
- Blocking org deletion for GoBD retention. Retention is the business's duty; `export-org-data` gives them the data (R7).
- Removing the Showflow domain (separate spec per ADR-0014).

## Reuse map

| Need | Existing piece | Use |
|---|---|---|
| Line items, editor, totals | `werkbank.document_items`, `LineItemsEditor.tsx`, `DocumentTotalsCard.tsx`, view `werkbank.document_totals` | Add `invoice_id` and a third view branch; components unchanged |
| Header fields, pickers | `DocumentHeaderFields.tsx`, `CustomerPicker`, `PropertyPicker`, `ContactSelect`, `DatePopover` | Reused on the invoice page |
| Copy with provenance | `create_order_from_quote` (copies header + items with `source_item_id`) | Same shape for `create_invoice_from_order` |
| Lock triggers | Quote lock and order lock triggers (Teil 3 R2) | Same pattern for invoices; order status check widened |
| Numbering | `werkbank.next_number`, `number_ranges`, `NumberingTab`, `data/numberRanges.ts` | New key `invoice` |
| Seller data | `werkbank.company_profiles`, `CompanyTab.tsx` | Two text columns and `payment_due_days` added |
| Buyer data | `customers` address and `invoice_email`; `properties.billing_*` override (Teil 2) | Snapshotted at issue |
| PDF on the edge | `_shared/werkbank/pdf/` (`fonts.ts`, `quoteDocument.tsx`, `quoteData.ts`) | Invoice document in the same style, same fonts |
| E-invoice | `@e-invoice-eu/core` 3.4.0 (ADR-0013 spike: Factur-X EN 16931 passed Mustang under Deno) | New dependency of `werkbank-invoices` only |
| Edge scaffolding | `werkbank-quotes/index.ts` (`handle(req, deps)`, `requireOrgRole`, `resolveOrgKind`), `_shared/http.ts`, `makeFakeDeps` | Same structure |
| Email with attachment | `send-transactional-email` (2 attachments, 5 MB, `reply_to`), `_shared/werkbank/emails/quote-sent.tsx` | One new template `invoice-sent` |
| Private storage | Bucket `werkbank-documents` and its policies (Teil 3 R4), `createSignedUrl` | Reused; one immutability trigger added |
| Lists, pages, errors | `QuotesPage`, `OrdersPage`, `OrderPage`, `DocumentsSection`, `fetchAllPages`, `mapDbError`, `orderStatus.ts`, `quotePreflight.ts` | Same patterns |
| UI primitives | `PageHeader`, `StatusPill`, `TONES`, `Metric`, `Token`, `EmptyState`, `SegmentedControl`, `formatEuro`, `src/lib/dates.ts` (`berlinDateKey`) | Reused |

## Requirements

### R1. Tables (schema `werkbank`)

All conventions of Teil 2 and 3 apply: `org_id ... on delete cascade`, composite foreign keys over `(org_id, id)`, `created_at`/`updated_at` with `public.update_updated_at_column()`, RLS enabled, insert/update/delete granted explicitly, admin and producer read and write.

**`werkbank.invoices`**

| Column | Type and rule |
|---|---|
| `type` | `text not null default 'invoice' check (in ('invoice','cancellation'))` |
| `invoice_no` | `text`, null while draft; set only by `finalize_invoice`; `unique (org_id, invoice_no)`; `check (status = 'draft' or invoice_no is not null)` |
| `order_id` | `uuid`, composite FK to orders, `on delete no action` |
| `cancels_invoice_id` | `uuid unique`, composite FK to invoices, `on delete no action`; `check ((type = 'cancellation') = (cancels_invoice_id is not null))` |
| `customer_id`, `property_id`, `contact_id`, `subject`, `location_note`, `discount_percent` | as on orders; the same trigger rejects a property of another customer |
| `intro_text`, `closing_text`, `payment_terms_text` | `text`, prefilled from the company profile on create |
| `service_date_from`, `service_date_to` | `date`; `check (service_date_to is null or service_date_from is not null)` and `to >= from`; from-date required at issue |
| `payment_due_days` | `integer not null default 14 check (between 0 and 365)`, prefilled from the profile |
| `issue_date`, `due_date` | `date`, set at issue (Berlin today, today plus `payment_due_days`) |
| `status` | `text not null default 'draft' check (in ('draft','issued','cancelled'))`; `cancelled` only for `type = 'invoice'` |
| `issued_at` | `timestamptz`, set at issue |
| `seller_snapshot`, `buyer_snapshot` | `jsonb`, set at issue (R2), `not null` unless draft |
| `pdf_path`, `pdf_sha256` | `text`, set once after rendering |
| `sent_at`, `sent_to` | `timestamptz`, `text[]`; updated on every send |

A partial unique index `(org_id, order_id) where type = 'invoice' and status <> 'cancelled'` allows at most one active invoice per order (drafts included).

Indexes: `(org_id)`, `(org_id, customer_id)`, `(org_id, status)`, `(order_id)`, `(property_id)`, `(contact_id)`, `(cancels_invoice_id)` is covered by its unique constraint.

**`werkbank.document_items`:** new column `invoice_id uuid`, composite FK to invoices, `on delete cascade`; the parent check becomes `num_nonnulls(quote_id, order_id, invoice_id) = 1`; index `(invoice_id)`. The draft-touch trigger of Teil 3 also touches draft invoices.

**`werkbank.company_profiles`:** new columns `invoice_intro text`, `invoice_closing text`, `payment_due_days integer not null default 14 check (between 0 and 365)`.

**`werkbank.orders`:** the status check gains `invoiced`.

### R2. Locks, numbers and functions

- **Invoice lock (trigger):** a draft is freely editable and deletable (header and items). Once `status <> 'draft'`, header, items and snapshots cannot change and the row cannot be deleted by anyone, admins included. Afterwards only the service role may set `pdf_path` and `pdf_sha256` (once, when null), `sent_at` and `sent_to`, and only the cancellation finalize may move `issued → cancelled`. `invoice_no`, `issue_date`, `due_date`, `issued_at` and the snapshots are written only inside `finalize_invoice`.
- **Order status:** transitions `done → invoiced` and `invoiced → done` happen only inside `finalize_invoice` (guarded by a transaction-local setting the order trigger checks). `invoiced` locks the order like `done`, and Wieder öffnen and Stornieren are not offered for it.
- **Numbers:** range `invoice` (prefix `RE-`, padding 4) is seeded like `quote` and `order`. Unlike those, gaps are not acceptable: a number is drawn only inside `finalize_invoice`, so a failed issue rolls the counter back with the rest of the transaction. `NumberingTab` lets admins edit the `invoice` prefix and start value only while the org has no issued invoice; a trigger on `werkbank.number_ranges` enforces this (ranges are written directly under RLS, not through an RPC), and `next_value` of `invoice` may never decrease.
- **RPCs** (`security definer`, `set search_path = ''`, role check admin or producer of the row's org, `revoke all ... from public, anon`, `grant execute ... to authenticated`):
  - `werkbank.create_invoice_from_order(p_order uuid) returns uuid`: only from `done`; copies header and items with `source_item_id`, prefills texts and `payment_due_days` from the profile, `service_date_from` from the Berlin date of `completed_at`. Fails on the partial unique index if an active invoice exists.
  - `werkbank.finalize_invoice(p_invoice uuid) returns werkbank.invoices`: locks the row; requires `draft`, at least one `item` line, `service_date_from`, a complete company profile (name, address, tax number or VAT id, IBAN) and a buyer address. Then in one transaction: draws the number, sets `issue_date`, `due_date`, `issued_at`, `status = 'issued'`, writes `seller_snapshot` (company profile) and `buyer_snapshot` (the property's billing override if set, else the customer; plus customer number, VAT id and invoice email). For `type = 'invoice'` with an order: order `done → invoiced` (fails if the order is not `done`). For `type = 'cancellation'`: original `issued → cancelled`, its order `invoiced → done`. Errors use distinct SQLSTATE messages that `mapDbError` maps to German copy.
  - `werkbank.cancel_invoice(p_invoice uuid) returns uuid`: only from an `issued` `invoice` without a cancellation; inserts a `cancellation` draft with the original's header, items, `order_id`, service dates and the intro text "Storno zu RE-0012 vom 08.10.2026". A second call fails on the unique `cancels_invoice_id`. The cancellation draft may be deleted again.
  - `werkbank.copy_invoice(p_invoice uuid) returns uuid`: a new `invoice` draft with the header and items of any invoice (also a cancelled one), keeping `order_id` only if that order is `done` and has no active invoice.
- Amounts stay positive on every document. The sign of a cancellation is applied in the UI and in Teil 5, not in storage.

### R3. Totals

`werkbank.document_totals` gains a third `union all` branch for `invoice_id`, the same SQL as the order branch. It stays the only implementation of the VAT and discount rules. A view `werkbank.invoice_list` (`security_invoker = true`) joins header, customer and property names, totals and the cancelling invoice's number for the list.

### R4. Storage

- Invoice files go to the existing bucket `werkbank-documents` at `<org_id>/invoices/<invoice_id>.pdf`, written only by the service role.
- A trigger on `storage.objects` (in a `*_werkbank_*` migration, function in schema `werkbank`) rejects `update` and `delete` of objects in `werkbank-documents` whose path's second segment is `invoices`. The isolation guard (nothing in `public` depends on `werkbank`) is unaffected because the trigger sits on `storage`. If the isolation test also scans `storage`, it gets a named allow-list entry with this reason.

### R5. Edge function `werkbank-invoices`

Structure as `werkbank-quotes`: `handle(req, deps)` plus `Deno.serve`, `requireOrgRole(org_id, ['admin','producer'])`, handwerk gate via `resolveOrgKind`, `[functions.werkbank-invoices]` in `config.toml` with `verify_jwt = true` (no public actions).

| Action | Behaviour |
|---|---|
| `preview` | Renders the draft as a PDF with a "ENTWURF" watermark, no XML; stores nothing |
| `issue` | Calls `finalize_invoice` with the caller's JWT client (so the role check applies), then renders, stores and stamps `pdf_path`/`pdf_sha256`. With `send: true` it continues with `send`. If the invoice is already `issued` and `pdf_path` is null, it skips the RPC and only renders (resume) |
| `send` | Requires `issued` or `cancelled` with `pdf_path`; downloads the stored file and sends it via `send-transactional-email` (template `invoice-sent`, `reply_to` = profile email), then sets `sent_at` and `sent_to`. Never re-renders |
| `download-url` | Signed URL (60 s) to the stored file |

Error contract as in Teil 3: `{ error: code }` with 400/403/404/409/500. A send failure after a successful issue returns 502 with `issued: true`, so the UI shows "Abgeschlossen, Versand fehlgeschlagen" and offers Erneut senden.

### R6. E-invoice pipeline (`supabase/functions/_shared/werkbank/einvoice/`)

1. **`invoiceData.ts`** (pure): builds one `InvoiceData` object from the invoice row, its items, its `document_totals` row and the snapshots. No VAT arithmetic in TypeScript; totals come from the view.
2. **`invoiceDocument.tsx`**: the PDF with `@react-pdf/renderer` and the embedded Geist fonts, layout of `quoteDocument.tsx`. Mandatory content (§14 UStG): seller name and address, tax number or VAT id, buyer address, invoice number, issue date, service date or period, items with quantity, unit, net prices, VAT per rate, totals, due date, bank details; for private customers "davon Lohnanteil (§35a EStG)". A cancellation is titled "Stornorechnung" and names the original's number and date.
3. **`facturx.ts`** (pure): maps `InvoiceData` to the `@e-invoice-eu/core` UBL input. Type code 380 for an invoice, 381 for a cancellation with the original in the billing reference (BT-25/26). The overall discount is one document-level allowance per VAT category (BG-20), matching the view's per-rate discounted net. Payment means SEPA credit transfer (code 58) with the IBAN; due date BT-9; payment terms text BT-20.
4. **Render step**: `@e-invoice-eu/core` turns the PDF and the input into `Factur-X-EN16931` (PDF/A-3, `factur-x.xml` embedded). The result is one file, well under the 5 MB attachment limit.

Every font in the PDF is embedded (ADR-0013 spike finding).

### R7. Email, export, notifications

- **`invoice-sent`** template in `_shared/werkbank/emails/`, registered in the transactional template registry: German, "Sie", modelled on `quote-sent.tsx`: subject "Rechnung RE-0012 von <Firma>", a short message, the amount and due date, the PDF attached. For a cancellation: "Stornorechnung RE-0013 zu RE-0012".
- **Recipient:** prefilled with the customer's `invoice_email`, else the contact's email, else the customer's email; optional CC.
- **`export-org-data`:** adds `invoices` to the exported `werkbank` tables (allow-listed touch point already exists).
- No in-app notification in Teil 4 (the office triggers every step itself).

### R8. Pages and navigation

New nav item **Rechnungen** (`/invoices`) in `src/features/werkbank/ui.ts`, after Aufträge, kinds `handwerk`, admin and producer. Patterns as in Teil 3.

- **Invoices list (`/invoices`):** `SegmentedControl` filter Alle, Entwurf, Offen (issued), Storniert; debounced search over number, customer, property, subject. Columns: Nr. (`Token`, "Entwurf" when null), Typ (cancellation as `StatusPill`), Kunde / Liegenschaft, Betreff, Rechnungsdatum, Fällig am, Brutto (`Metric`, negative for cancellations), Status. A notice "Erledigt, noch nicht abgerechnet" with a count links to the orders list filtered to `done`. Action "Rechnung anlegen" (free invoice).
- **Invoice page (`/invoices/:id`):**
  - Draft: `DocumentHeaderFields` plus service date (from, optional to) and payment term in days; `LineItemsEditor`; `DocumentTotalsCard`. Actions Vorschau, Löschen, Abschließen.
  - Issue dialog: checklist from a pure `invoicePreflight()` (`src/features/werkbank/lib/invoicePreflight.ts`, same rules as the RPC: items, service date, profile complete, buyer address, recipient when sending); recipient and CC; buttons "Abschließen und senden" and "Nur abschließen"; the warning "Danach ist die Rechnung nicht mehr änderbar."
  - Issued: read-only view, actions PDF, Senden / Erneut senden, Stornieren (confirm dialog, opens the cancellation draft), Kopieren. History: issued (when, by), sent (when, to whom), cancelled by (link). Without a file: "PDF wird erzeugt" with Erneut versuchen (calls `issue` again).
  - Cancelled original: a banner with a link to the cancellation and the action "Korrigierte Rechnung anlegen" (`copy_invoice`).
- **Order page:** on `done` the action "Rechnung erstellen"; on `invoiced` the status "Abgerechnet" and a link to the invoice. Orders list: filter Abgerechnet. `orderStatus.ts` gets `invoiced` with a tone from `TONES`.
- **Customer and property detail pages:** `DocumentsSection` gains "Rechnungen".
- **Settings:** `CompanyTab` gains payment term in days, invoice intro and closing; `NumberingTab` shows the `invoice` range (start value locked after the first issue).
- **Dashboard:** `StartList` gains the step "Erste Rechnung abschließen".
- **Copy:** `werkbank` namespace, Du in the app, Sie in PDF and email. New terms in `src/i18n/terms.ts` (Rechnung, Stornorechnung, Abgerechnet, Leistungsdatum, Fällig am). Help items (EN + DE) for creating, issuing, cancelling and correcting. Page mini for `/invoices` (`src/lib/minis/pages/invoices.ts`, illustration `InvoicesMini.tsx`).

## Testing

Tests first (CLAUDE.md).

- **pgTAP (`supabase/tests/werkbank/`):** issued invoice rejects update, item change and delete, also as admin; numbers are gapless across a failed finalize (rollback) and across invoice and cancellation; one active invoice per order; `done ↔ invoiced` only through `finalize_invoice`; cancellation sets original `cancelled` and order `done`, a second cancellation fails; another org's invoice is rejected in every RPC; `document_totals` gives identical values for an invoice and its source order; the storage trigger blocks update and delete under `invoices/`; RLS and grants on `invoices` (the existing isolation test picks the table up).
- **Deno:** `invoiceData` and `facturx` with fixed cases (discount, mixed 19/7/0, cancellation with reference, private customer §35a, billing override); handler tests for each action, including resume after a render failure, send failure after issue (502, `issued: true`), wrong role, non-handwerk org.
- **Vitest:** `invoicePreflight`, data-access functions with `supabaseFake`, the list, the invoice page in draft, issued and cancelled state, the order action, the new `orderStatus` entry.
- **CI job `einvoice-validate`:** a Deno script renders fixture invoices (plain, discount, mixed rates, cancellation) through the real pipeline; the Mustang CLI (pinned version, checksum-verified download, Java from `actions/setup-java`) validates each file; zero findings required.
- **Playwright (`e2e/werkbank-invoices.spec.ts`):** finish an order, create the invoice, issue without sending, cancel, issue the cancellation, create and issue the corrected copy; the order ends `invoiced`.

## Delivery

First step of the plan: a probe that renders a fixture invoice through `@e-invoice-eu/core` inside `supabase functions serve` (the production edge runtime) and checks the function bundle size. If it fails, stop and decide again before any UI work.

Three stacked PRs (owner rule: at most three per Teil), migrations applied by the Supabase GitHub integration on merge:

1. **Foundation:** runtime probe, migrations (R1 to R4), RPCs, view, storage trigger, pgTAP, regenerated types, `invoicePreflight`.
2. **E-invoice and sending:** R5 to R7, `einvoice-validate` CI job, Deno tests.
3. **UI:** R8, help, page mini, Playwright.
