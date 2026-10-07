# Werkbank Teil 3: Quotes and orders (Angebot zu Auftrag). Spec

**Date:** 2026-10-07
**Status:** Draft, awaiting owner review.
**Decision records:** [ADR-0014](../../adr/0014-werkbank-as-separate-fork.md) (separate fork; the ADR-0013 isolation rules still hold), [ADR-0013](../../adr/0013-werkbank-as-removable-module.md).
**Builds on:** `2026-10-07-werkbank-stammdaten-design.md` (Teil 2: customers, properties, contacts, catalog, number ranges).

---

## Problem

After Teil 2 the pilot business has its customers, properties and service catalog in Werkbank, but it still writes quotes in Word, sends them by hand and tracks approvals by email. Orders from property managers arrive with or without a quote and live in their heads or on paper. Teil 4 (invoices) needs a clean record of what was agreed and what was done.

**Success:** the office writes a correct quote for a property manager in a few minutes, sends it from Werkbank, the property manager accepts it online with a signature, and the office turns it into an order with one click, optionally with a date and technicians. A repair order without a quote is created just as quickly.

## Decision summary (locked with the owner, 2026-10-07)

| Question | Decision |
|---|---|
| How orders arise | Mixed: from an accepted quote, or created directly without one |
| Scheduling | An order can carry a planned date, an optional time and any number of technicians; all optional. No planning board |
| Delivery and acceptance | Sent from Werkbank by email with the PDF and a link; the customer accepts or rejects online without an account |
| Acceptance capture | Name, signature (drawn or typed, the existing `SignaturePad`), consent checkbox; rejection with an optional comment |
| Sender address | The existing (Showflow) sender for now; a Werkbank sender domain is a go-live item |
| Line items | Items (catalog or free), section titles with subtotals, text lines, one overall discount in percent |
| Changes after sending | A sent quote is locked; "Überarbeiten" creates the next version (`A-0042-2`), the old one is superseded. Plus "Kopieren" into a new quote |
| Quote to order | The order gets an editable copy of the lines; the quote stays unchanged and the order shows the difference |
| Order on acceptance | Not automatic: the office is notified and creates the order with one click |
| Company data | A structured Werkbank company profile (seller data for Teil 4), with logo and default quote texts |
| Data model | Separate header tables for quotes and orders, one shared line-item table (Approach 1) |
| Principle | Reuse native features and existing code first; write as little new code as needed (CLAUDE.md, "Reuse before you build") |

## Non-goals

- Optional and alternative items, per-line discounts, change-order quotes that need a second approval.
- Planning board or calendar, technician access (Teil 6), time tracking.
- Invoices, deposits, the `abgerechnet` order status (Teil 4).
- English PDFs or an English public page; both are German in V1.
- A Werkbank sender domain or app domain (go-live items only).
- Reminders or follow-ups for open quotes (a good small successor).
- A live, in-browser PDF preview while typing. Preview is an explicit button that asks the server (R6).
- Removing the Showflow domain (separate spec per ADR-0014).

## Reuse map

What this spec builds on instead of writing new code. Paths are exact.

| Need | Existing piece | Use |
|---|---|---|
| PDF rendering on the edge | `@react-pdf/renderer` (npm, already used), the embedded Geist fonts in `fonts.ts` + `inflateFontGzB64` (`fontInflate.ts`, mirrored pair under `src/lib/hireOrders/pdf/` and `_shared/hire-order-pdf/`) | Move only the two font files to a neutral `src/lib/pdf/` / `_shared/pdf/` mirror pair (R11); Werkbank imports react-pdf from npm directly. The hire-order `pdfDeps.ts` (themes, font bucket) stays as is. Only the quote document is new |
| Signature capture | `src/components/hireOrders/SignaturePad.tsx` (`SignaturePad`, `SignatureValue`) | Move to `src/components/common/SignaturePad.tsx`; its four strings move from `hireOrdersPages:signaturePad.*` to `common:signaturePad.*` (R11) |
| Signature validation | `generate-hire-orders/index.ts`: `decodePngOrNull`, `MAX_SIGNATURE_PNG_CHARS`, IP from `x-forwarded-for`, `user-agent` | Same rules in `_shared/werkbank/acceptance.ts` |
| Audit row shape | `public.hire_order_signatures` | Same columns in `werkbank.quote_acceptances`, without a user id |
| Public token endpoint | `sandbox-view` (`verify_jwt = false`, `not_found` 404, `revoked`/`expired` 410) | Same response contract; tokens stored as SHA-256 (`crypto.subtle`), not plaintext |
| Public page | `src/pages/SandboxViewerPage.tsx`, `UnsubscribePage.tsx` | Same shape: `useParams().token`, one query, a state per reason |
| Email with attachment | `send-transactional-email` (`deps.sendEmail`, `attachments` with `content_base64`, 2 files, 5 MB) | Reused; add an optional `reply_to` (R11) |
| Email layout | `_shared/transactional-email-templates/hire-order-issued.tsx` | Template model for the three new emails |
| Private storage, signed URLs | Supabase Storage `createSignedUrl`, `hire-orders` bucket policies (`storage.foldername(name)[1]::uuid` org check) | Same policies for two new buckets |
| In-app notifications | `notifications` table (no type check), `notifyProducersCountersigned` pattern, `src/lib/notifications/entityRoutes.ts` | New unmapped types (always delivered) and one route entry |
| Number ranges | `werkbank.next_number`, `assign_customer_no` trigger, `NumberingTab`, `data/numberRanges.ts` | New keys `quote` and `order`; widen the key type |
| Pickers | `CustomerPicker`, `usePropertiesForCustomer`, `useContacts`, `useCatalogItems`, `useTechnicians` | Reused; small new pickers built the CustomerPicker way (cmdk + Popover) |
| Row reordering | `framer-motion` `Reorder` as in `src/pages/ProductionsPage.tsx` | Reused; no new dependency |
| Lists, detail pages, errors | `CustomersPage`, `CustomerDetailPage`, `fetchAllPages`, `mapDbError`, the `use<Entity>Mutation` wrappers | Same patterns |
| UI primitives | `PageHeader`, `StatusPill`, `TONES`, `Metric`, `Token`, `KpiTile`, `EmptyState`, `SegmentedControl`, `formatEuro`, `src/lib/dates.ts` | Reused |
| Edge scaffolding | `handle(req, deps)`, `_shared/auth.ts` (`requireOrgRole`), `_shared/http.ts`, `makeFakeDeps` | Reused |
| Kind gate on the edge | `resolveOrgKind` | Reused instead of a new entitlement key |
| Totals arithmetic | Postgres `numeric` and `round()` | One SQL view; no TypeScript copy of the VAT rules (R3) |

## Requirements

### R1. Tables (schema `werkbank`)

All tables follow Teil 2: `org_id uuid not null references public.organizations(id) on delete cascade`, composite foreign keys over `(org_id, id)`, `created_at`/`updated_at` with `public.update_updated_at_column()`, RLS enabled, insert/update/delete granted explicitly.

**`werkbank.company_profiles`** (one row per org, primary key `org_id`)

| Column | Type and rule |
|---|---|
| `company_name` | `text not null`, not blank |
| `legal_form` | `text` |
| `street`, `postal_code`, `city` | `text not null`, not blank; DE postal code check as on customers |
| `country_code` | `text not null default 'DE'` |
| `phone`, `email`, `website` | `text`; email check as on customers |
| `tax_number`, `vat_id` | `text`; `vat_id` check as on customers |
| `register_court`, `register_number` | `text` |
| `iban`, `bic`, `bank_name` | `text`; `iban` matches `^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$` after removing spaces in the UI |
| `logo_path` | `text`, object key in bucket `werkbank-assets` |
| `quote_intro`, `quote_closing`, `payment_terms_text` | `text` |
| `quote_validity_days` | `integer not null default 30 check (between 1 and 365)` |

Read by admin and producer, written by admin only.

**`werkbank.quotes`**

| Column | Type and rule |
|---|---|
| `quote_no` | `text not null`, assigned by trigger from range `quote` on insert when `version = 1`; copied for later versions |
| `version` | `integer not null default 1 check (version >= 1)`; `unique (org_id, quote_no, version)` |
| `superseded_by` | `uuid`, composite FK to `quotes`, `on delete set null` |
| `customer_id` | `uuid not null`, composite FK to customers, `on delete no action` |
| `property_id` | `uuid`, composite FK to properties; a trigger rejects a property of another customer |
| `contact_id` | `uuid`, composite FK to contacts, `on delete set null` |
| `location_note`, `subject` | `text` |
| `intro_text`, `closing_text`, `payment_terms_text` | `text`, prefilled from the company profile on create |
| `discount_percent` | `numeric(5,2) not null default 0 check (between 0 and 100)` |
| `valid_until` | `date not null`, default today plus `quote_validity_days` (set by the client from the profile) |
| `status` | `text not null default 'draft' check (in ('draft','sent','accepted','rejected','superseded'))` |
| `sent_at`, `sent_to` | `timestamptz`, `text[]` |
| `pdf_path`, `pdf_sha256` | `text`, set once on send |
| `accepted_pdf_path` | `text`, set on acceptance |
| `access_token_hash` | `text unique`, SHA-256 hex of the link token |
| `link_revoked_at` | `timestamptz` |

"Abgelaufen" is not stored: a quote is expired when `status = 'sent'` and `valid_until` is before today in Berlin time (`berlinDateKey`). The UI, the view `quote_list` (R3) and the edge function derive it the same way.

**`werkbank.orders`**

| Column | Type and rule |
|---|---|
| `order_no` | `text not null`, assigned by trigger from range `order`; `unique (org_id, order_no)` |
| `quote_id` | `uuid unique`, composite FK to quotes, `on delete no action` |
| `customer_id`, `property_id`, `contact_id`, `location_note`, `subject`, `discount_percent` | as on quotes, same property trigger |
| `notes` | `text` |
| `status` | `text not null default 'open' check (in ('open','in_progress','done','cancelled'))` |
| `scheduled_date` | `date` |
| `scheduled_time` | `time`, only with a date (`check (scheduled_time is null or scheduled_date is not null)`) |
| `completed_at`, `cancelled_at` | `timestamptz`, set by the status trigger |

**`werkbank.order_technicians`**: `org_id`, `order_id` (composite FK, `on delete cascade`), `artist_id` (`references public.artists(id) on delete cascade`), primary key `(order_id, artist_id)`. A trigger rejects an artist of another org.

**`werkbank.document_items`**

| Column | Type and rule |
|---|---|
| `quote_id`, `order_id` | `uuid`, `check (num_nonnulls(quote_id, order_id) = 1)`, composite FKs, `on delete cascade` (the `contacts` pattern of Teil 2) |
| `sort_order` | `integer not null` |
| `kind` | `text not null check (in ('title','item','text'))` |
| `name` | `text`, required for `title` and `item` |
| `description` | `text`, required for `text` |
| `catalog_item_id` | `uuid`, composite FK `(org_id, catalog_item_id)` to catalog items, `on delete set null (catalog_item_id)` (reference only) |
| `item_no` | `text`, snapshot |
| `quantity` | `numeric(12,3)` |
| `unit_code` | `text`, same check as catalog items |
| `labour_price`, `material_price` | `numeric(12,2)`, `>= 0` |
| `vat_rate` | `numeric(4,2)`, in (19, 7, 0) |
| `line_net` | `numeric(12,2) generated always as (round(quantity * (labour_price + material_price), 2)) stored` |
| `source_item_id` | `uuid`, FK to `document_items`, `on delete set null`; an order line points at the quote line it came from |

A check per kind: `item` requires name, quantity > 0, unit, both prices and VAT; `title` and `text` require those to be null.

**`werkbank.quote_acceptances`**: `org_id`, `quote_id` (`unique`, composite FK, `on delete cascade`), `decision` (`accepted` or `rejected`), `comment`, `signer_name` (`not null`), `method` (`typed` or `drawn`, required when accepted), `typed_name`, `signature_image_path`, `decided_at`, `ip`, `user_agent`, `consent_text`, `document_sha256` (`not null`). Written only by the service role. Read by admin and producer.

Indexes: `(org_id)` on every table, `(org_id, customer_id)` on quotes and orders, `(quote_id)` and `(order_id)` on items, `(org_id, status)` on quotes and orders, `(org_id, scheduled_date)` on orders.

### R2. Locks, numbers and functions

- **Quote lock (trigger):** once `status <> 'draft'`, header content and its items cannot change. Allowed afterwards: status transitions, `valid_until` (extend), `link_revoked_at`, `superseded_by`, and the send/accept columns, all only by the service role, except `valid_until` and `link_revoked_at`, which admin and producer may set.
- **Order lock (trigger):** items and header content are editable in `open` and `in_progress`, locked in `done` and `cancelled`. Transitions: `open → in_progress → done`, `done → in_progress` (reopen), `open | in_progress → cancelled`. The trigger stamps `completed_at` and `cancelled_at`.
- **Numbers:** ranges `quote` (prefix `A-`) and `order` (prefix `AU-`) are seeded like `customer`, padding 4. Triggers call `werkbank.next_number` the way `assign_customer_no` does. Gaps from deleted drafts are acceptable for quotes and orders.
- **RPCs** (`security definer`, `set search_path = ''`, role check admin or producer of the row's org, `revoke all ... from public, anon`, `grant execute ... to authenticated`):
  - `werkbank.revise_quote(p_quote uuid) returns uuid`: from `sent` or `rejected` (or expired); inserts version n+1 as `draft` with copied header and items, sets the old row `superseded` with `superseded_by` and `link_revoked_at`. The revision keeps `valid_until`, unless it lies before Berlin today: then today plus the profile's `quote_validity_days` (30 without a profile).
  - `werkbank.copy_quote(p_quote uuid, p_customer uuid default null, p_property uuid default null) returns uuid`: a new draft with a new number, version 1.
  - `werkbank.create_order_from_quote(p_quote uuid) returns uuid`: only from `accepted`; copies header and items with `source_item_id`; a second call fails on the unique `quote_id`.

### R3. Totals (one SQL view)

`werkbank.document_totals` (`security_invoker = true`, so RLS applies) returns per document (`quote_id` or `order_id`):

- per VAT rate: net = sum of `line_net`, discounted net = `round(net * (1 - discount_percent / 100), 2)`, VAT = `round(discounted net * rate / 100, 2)`;
- `net_total`, `discount_total`, `vat_total`, `gross_total` as sums over the rates;
- `labour_total` = discounted labour share, for the §35a line on private customers.

This is the only implementation of the VAT and discount rules; it matches the EN 16931 calculation model Teil 4 needs (document-level allowance per VAT category, tax rounded per category). The editor shows these values after each save (R5); section subtotals are a plain sum of `line_net` in the client. `werkbank.quote_list` and `werkbank.order_list` views join headers, customer and property names, totals and the derived expired flag for the lists.

### R4. Storage

Two private buckets created in a `*_werkbank_*` migration, with the `hire-orders` policy model (first path segment is the org id; read for org admin and producer):

- `werkbank-assets`: logos (PNG or JPEG, at most 1 MB, set on the bucket); insert, update and delete for org admins (client upload with `supabase.storage`).
- `werkbank-documents`: quote PDFs, accepted PDFs, signature images; written by the service role only.

### R5. Pages and navigation

New nav items in `src/features/werkbank/ui.ts` (section `workspace`, kinds `handwerk`, admin and producer): Angebote (`/quotes`), Aufträge (`/orders`). Patterns as in Teil 2 (`PageHeader`, `Skeleton`, `Alert`, `EmptyState`, `PageMini`).

- **Quotes list (`/quotes`):** `SegmentedControl` status filter (Alle, Entwurf, Versendet, Angenommen, Abgelehnt, Abgelaufen), debounced search over number, customer, property and subject. Columns: Nr. (`Token`), Kunde / Liegenschaft, Betreff, Brutto (`Metric`), Status (`StatusPill`), Gültig bis, Versendet am. A notice "Angenommen, noch kein Auftrag" with a count filters to those quotes. Action "Angebot anlegen".
- **Quote page (`/quotes/:id`):**
  - Header form: `CustomerPicker`, a property picker filtered by customer (built like `CustomerPicker`), a contact select, subject, location, valid until. Intro, closing and payment terms in collapsible textareas.
  - Line editor (`components/LineItemsEditor.tsx`, shared with orders): rows of kind title, item, text; add from the catalog through a `CatalogItemCombobox` (cmdk, client-side search over number, name, category), add a free item, a title or a text line; edit quantity and prices inline (saved per row, debounced); reorder with `Reorder.Group`; delete. Titles show the sum of their items. Units use the Teil 2 labels.
  - Totals card from `document_totals`: net, discount, VAT per rate, gross; for private customers "davon Lohnanteil (§35a EStG)".
  - Draft actions: Vorschau (R6 `preview`, opened in a new tab), Versenden (dialog), Löschen.
  - Send dialog: recipient prefilled with the contact's email, else the customer's (invoice email not used for quotes), optional CC, a prefilled message; a checklist from a pure `quotePreflight()` (company profile complete, at least one item, a recipient, `valid_until` not past). Sending is disabled until it passes.
  - After sending: read-only, actions PDF, Überarbeiten, Kopieren, Verlängern (date picker), Link sperren, Erneut senden, and on `accepted` "Auftrag anlegen". A short history list: sent (when, to whom), decision (when, who, signature image, comment). Versions link to each other.
- **Orders list (`/orders`):** status filter (Offen, In Arbeit, Erledigt, Storniert), technician filter, date range, quick filter "Nicht eingeplant" (no date). Columns: Nr., Kunde / Liegenschaft, Betreff, Termin, Monteure, Brutto, Status. Action "Auftrag anlegen" (direct order).
- **Order page (`/orders/:id`):** header as on quotes plus notes; card "Einsatz" with date, time and a `TechnicianMultiSelect` (cmdk with check marks and chips, data from `useTechnicians`); the shared line editor; for orders from a quote a comparison line "Angebot A-0042: x € · Auftrag: y € · Differenz" with changed and new lines marked (via `source_item_id`); status actions Beginnen, Erledigt, Wieder öffnen, Stornieren.
- **Customer and property detail pages:** new sections "Angebote" and "Aufträge" (number, subject, status, gross) with a create action that preselects the customer and property.
- **Public quote page (`/quote/:token`, no login):** mobile first. Header with the business logo and name; the quote with sections, items and totals; "PDF herunterladen". Below: accept (name, `SignaturePad`, consent checkbox, button) and reject (optional comment). States: `not_found`, `superseded` ("Es gibt eine neuere Fassung, sie kommt per E-Mail"), `expired`, `revoked`, `decided` (shows the decision and, if accepted, the accepted PDF). German only, and addressed with "Sie": the reader is the business's customer, not a Werkbank user, so the Du rule for app copy does not apply here or in customer emails. If `copyLint.test.ts` scans this copy, it gets a named exemption.

### R6. Edge function `werkbank-quotes`

`verify_jwt = false` in `config.toml` (it has public actions). `handle(req, deps)` with an `action` field. Internal actions call `requireOrgRole(deps, req, orgId, ['admin','producer'])` and check the org kind with `resolveOrgKind`.

Internal:
- `preview { quote_id }`: renders the PDF with a "Entwurf" watermark and returns `{ pdf_base64 }`. Persists nothing.
- `send { quote_id, to[], cc[], message }`: re-runs the preflight on the server; renders the PDF; uploads it to `werkbank-documents/<org>/quotes/<id>-<first 16 hex of its SHA-256>.pdf` without overwriting (a concurrent second send cannot replace the stored bytes); computes SHA-256 with `crypto.subtle`; creates a 32-byte random token and stores only its hash; in one update sets `status = 'sent'`, `sent_at`, `sent_to`, `pdf_path`, `pdf_sha256`, `access_token_hash`; then sends the `quote-sent` email with the PDF attached, the link `<app>/quote/<token>` and `reply_to` = the profile email. If the email fails the quote stays `sent` and the response says so; the UI offers "Erneut senden".
- `resend { quote_id, to[], cc[], message }`: only for `sent`; a new token (the old link stops working), the same stored PDF, a new email.
- `download-url { quote_id, kind: 'sent' | 'accepted' }`: a signed URL valid for 10 minutes.

Public (body `{ token }`, looked up by the token's SHA-256):
- `view`: returns the display data (business name and logo as a signed URL, recipient block as printed, sections, items, totals, valid until, status) and a 10-minute signed URL of the PDF, or a state from R5 with status 404 (`not_found`) or 410 (`superseded`, `expired`, `revoked`, `decided`), as in `sandbox-view`.
- `decide { token, decision, signer_name, signature?, comment?, consent: true }`: re-checks the state; validates the signature like `signOrder` (typed name, or a PNG data URL with the PNG signature and the size cap); records IP and user agent; inserts `quote_acceptances` with `document_sha256 = pdf_sha256` and the server's consent text. On accept it uploads the signature, renders the accepted PDF (the sent document plus a signature block) to `accepted_pdf_path`, and sets `status = 'accepted'`; on reject `status = 'rejected'`. The unique `quote_id` makes a second decision fail with `decided`. Then it notifies the office (R7) and emails the customer a confirmation (with the accepted PDF when accepted).

No extra rate limit: a 256-bit token cannot be guessed and a decision is final, so a throttle would protect nothing.

The quote document (`_shared/werkbank/pdf/quoteDocument.tsx`) is the only new PDF code. It imports react-pdf from npm and registers the embedded Geist fonts from `_shared/pdf/` in a small `_shared/werkbank/pdf/fonts.ts`. Layout: letterhead with logo and sender line, recipient block (the property's billing recipient with "vertreten durch" as in Teil 2, else the customer), number, date, valid until, subject, intro, numbered sections (1, 1.1) with subtotals, text lines, totals per VAT rate, §35a labour share for private customers, closing text, payment terms, a footer with company, register, tax and bank data. The function needs its own `deno.json` like `generate-hire-orders`.

### R7. Emails and notifications

- Three templates in `_shared/werkbank/emails/`, modelled on `hire-order-issued.tsx`: `quote-sent` (to the customer, PDF attached, link), `quote-decided` (to admins and producers of the org), `quote-decision-confirmation` (to the signer's address, which is the recipient of the sent email). Registered in `_shared/transactional-email-templates/registry.ts`, `EMAIL_TEMPLATE_KEYS`/defaults in `src/lib/emailTemplates/emailCopy.ts` and `EMAIL_TEMPLATE_CATEGORY` (transactional). Copy in German, Du-form only towards office users; customer-facing emails use "Sie".
- Sender: `resolveFromAddress` as today (the Showflow sender). `reply_to` is the company profile email.
- In-app: types `quote_accepted` and `quote_rejected` to every admin and producer of the org (the `notifyProducersCountersigned` pattern), `related_entity_type = 'werkbank_quote'`, routed to `/quotes/:id` in `src/lib/notifications/entityRoutes.ts`. The types stay unmapped in `category_of`, so they are always delivered.
- Links in emails use `appUrl` / `brandAppUrl`. The `APP_URL` secret of this Supabase project must point at the Werkbank app (go-live).

### R8. Settings

- New tab "Firmendaten" (`?tab=company`, admins only, `handwerk` only via `SETTINGS_TAB_KINDS`): the profile fields of R1, a logo upload (PNG or JPEG, at most 1 MB, shown as a preview), the default texts and the validity in days.
- Tab "Nummernkreise" lists the ranges `customer`, `quote`, `order`; `NumberRangeKey` and `useSaveNumberRange` take the key as a parameter instead of the fixed `"customer"`.

### R9. Dashboard, help, minis, changelog

- Werkbank dashboard: two `KpiTile`s for the office, "Angenommen, ohne Auftrag" and "Aufträge ohne Termin", each linking to the filtered list; the Teil 2 start list gains a step "Firmendaten ausfüllen".
- Help items (EN and DE, Du, no dashes) for quotes, versions, online acceptance, orders, scheduling and company data in `src/lib/help/items.ts`.
- Page minis for `/quotes` and `/orders`; the detail pages and the public page get "No mini." (detail pages extend their list; the public page has no app shell).
- Changelog entry for Teil 3 in `public/changelog.md`, JSON regenerated.

### R10. Errors

- `mapDbError` gains: the lock trigger ("Dieses Angebot wurde inzwischen versendet und ist gesperrt." / "Dieser Auftrag ist abgeschlossen."), the property-customer trigger, and the unique `quote_id` on orders ("Für dieses Angebot gibt es schon einen Auftrag.").
- Edge errors return `{ error: code }`; the UI maps codes to `werkbank` copy and shows a sonner toast.
- A save on a quote that was sent meanwhile fails on the lock; the page refetches and shows it read-only.

### R12. Org data export

`export-org-data` adds the six new tables to its Werkbank list (Teil 2 R11 pattern). Storage objects are not exported, as for hire orders.

### R11. Core changes (kind-neutral, no behaviour change for Showflow)

Each is small and makes an existing piece usable instead of copying it:

1. **Fonts:** move `fonts.ts` and `fontInflate.ts` (and their tests) from `src/lib/hireOrders/pdf/` to `src/lib/pdf/`, retarget their entries in `scripts/mirrors.manifest.json` to `_shared/pdf/`, and update the imports in both `pdfDeps.ts` files and `scripts/compress-fonts.mjs`. Werkbank renders on the edge only and imports `npm:@react-pdf/renderer@^4` directly.
2. **SignaturePad:** move to `src/components/common/SignaturePad.tsx` (with its test); move its keys to `common:signaturePad.*` in EN and DE; `SignHireOrderDialog` imports the new path.
3. **Reply-To:** optional `reply_to` on `EmailMessage` and in the Resend request of `send-transactional-email`.
4. **Public module routes:** `ModuleUi.publicRoutes` in `src/modules/ui.ts`; `App.tsx` renders them without `ProtectedRoute` and `AppLayout`, like `ROUTES.SANDBOX`. Core never names the module.
5. **Allow-lists:** `scripts/moduleIsolation.test.ts` and the ESLint negations get named entries for the touch points: the email registry and email copy keys, `entityRoutes.ts`, the settings tab list, help items and minis.

## Testing

Test-first; tests import the real modules.

- **pgTAP (`supabase/tests/werkbank/`):** RLS per role on every new table (admin and producer read and write; producer cannot edit the company profile; technicians and other orgs see nothing; acceptances are not writable by `authenticated`); every check of R1; the property-customer and artist-org triggers; quote and order locks and transitions; number assignment for both ranges; `revise_quote`, `copy_quote`, `create_order_from_quote` including refusals; `document_totals` for mixed VAT rates, discount, rounding edge cases and the labour share; storage policies; the isolation test (RLS everywhere, function grants, nothing in `public` depends on `werkbank`).
- **Vitest:** data layer with `supabaseFake`; `quotePreflight`; `LineItemsEditor` (add from catalog, reorder, subtotal per title, inline edit); pickers; the quote and order pages (role gating, read-only after send, comparison line); the send dialog; the public page in every state; settings tabs; `mapDbError`; copy lint and key parity; `moduleIsolation.test.ts`.
- **Deno (`werkbank-quotes`):** every action with `makeFakeDeps`: authorization, preflight refusal, send order of steps (PDF stored before the status change, email last), email failure leaves `sent`, resend rotates the token, `view` states, `decide` validation, double decision, notification and confirmation email; the quote document renders for a sample quote (smoke test on bytes and page count). The moved fonts and `reply_to` keep the existing hire-order and email tests green.
- **Playwright (`e2e/werkbank-angebot.spec.ts`):** an admin creates a quote with a title, a catalog item and a text line, sends it (email captured by the local stack), opens the link, signs and accepts, sees the notification and creates the order, assigns a technician and a date.

## Delivery

Three PRs (owner ruling: at most three), each green on its own:

1. **Foundation:** R11 items 1 to 4 (core prep, Showflow behaviour unchanged), R1 to R4, types (`--schema public,graphql_public,werkbank`) and mirrors, R8 (company profile and numbering tabs).
2. **Quotes end to end:** R5 quotes list and page, line editor and pickers, R6, R7, the send dialog, the public page, R10.
3. **Orders and the rest:** R5 orders and the customer and property sections, R9, Playwright.

## Go-live checklist additions

1. Migrations reach production through the Supabase GitHub integration, never by hand.
2. `werkbank` is listed under "Exposed schemas" (still open from Teil 2).
3. `supabase/config.toml` has `[functions.werkbank-quotes] verify_jwt = false`.
4. The `APP_URL` secret of `wmtbjajmnjxefrhkchts` points at the Werkbank app, so quote links do not lead to Showflow.
5. The emails go out from the Showflow sender until a Werkbank sender domain is set up; set it up before the pilot's first real quote, because a Showflow sender on a Werkbank quote can confuse recipients or land in spam.
6. The pilot business fills in its company profile and logo before the first quote.

## Risks

- **Showflow sender on customer emails.** Interim only; see go-live item 5.
- **Preview latency.** The PDF preview is a server round trip (one to two seconds). Acceptable because it is an explicit action, not live.
- **Signature legal weight.** A simple electronic signature with an audit trail (name, image, time, IP, user agent, document hash). Sufficient for a work order (no written form required); not a qualified signature.
- **Section subtotals after a discount.** Subtotals are shown before the overall discount, which is applied once in the totals. The PDF says so ("Rabatt auf die Gesamtsumme").
- **Moving core files.** The font and `SignaturePad` moves touch hire-order code; the existing hire-order tests guard them, and PR 1 contains nothing else.
