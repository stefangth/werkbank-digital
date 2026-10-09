# Werkbank Teil 6a: Technician app on site (Monteur-App, Einsatz vor Ort). Spec

**Date:** 2026-10-08
**Status:** Draft, awaiting owner review.
**Decision records:** [ADR-0014](../../adr/0014-werkbank-as-separate-fork.md) (separate fork; the ADR-0013 isolation rules still hold), [ADR-0013](../../adr/0013-werkbank-as-removable-module.md) (roadmap row 6).
**Builds on:** `2026-10-07-werkbank-angebot-auftrag-design.md` (Teil 3: `orders`, `order_technicians`, `document_items`, `order_transition`, `company_profiles`), `2026-10-08-werkbank-rechnung-design.md` (Teil 4: `invoiced` status, PDF parts), `2026-10-06-werkbank-fundament-design.md` (Teil 1: technicians are `artists` with the `artist` app role).
**Followed by:** Teil 6b (time and material capture, office review into order lines, report PDF as invoice attachment). Separate spec.

---

## Problem

After Teil 5 the office runs quotes, orders, invoices and dunning in Werkbank, but the technicians who do the work are outside it. A technician who accepts the invitation from the "Monteure" page signs in and sees nothing: every `werkbank` table is readable only by `admin` and `producer`, and every Werkbank nav item is gated to those roles. The role description already promises "Sieht die eigenen Aufträge und meldet sie als erledigt". Today the office phones or messages the address, the contact and the tasks to the technician, and learns by phone that a job is done. Proof of work for property managers is a paper slip or a photo in a chat.

**Success:** a technician opens Werkbank on the phone, also in a basement without signal, and sees today's jobs with address, contact and tasks, without prices. They start and complete a job with one tap each, write a visit report with photos, and have the customer sign on the screen. The office sees the report on the order the moment it is saved and produces a PDF proof of work in one click.

## Decision summary (locked with the owner, 2026-10-08)

| Question | Decision |
|---|---|
| Scope of Teil 6 | Split: 6a on-site work (this spec), 6b time and material capture (later spec) |
| Offline | Read offline, write online. Jobs are cached on the device; status, report, photos and signature need a connection |
| What a technician sees | Own assigned orders only. Customer, property address, contact, date, subject, notes, line items with quantity and unit. No prices, discounts, totals, quotes, invoices or open items |
| Data access | Through `security definer` RPCs only; no direct table grants for technicians (Approach 1) |
| "Erledigt" | Sets the order to `done` directly. The office can reopen (`done` to `in_progress`) as today, until an invoice exists |
| Reports per order | Several: one visit report per visit (date, technician, text, photos, optional signature) |
| Locking | A report locks when signed or when the technician closes it without a signature. Locked means immutable; the office can only add an internal note |
| Report output | Internal on the order, plus a PDF on demand for the office. No automatic sending |
| App form | Installable PWA; works in a normal browser tab as well. Service worker scoped to `/einsaetze/` so the office UI is unchanged |
| List | Own orders, grouped: Überfällig, Heute, Nächste 7 Tage, Ohne Termin, Erledigt (last 14 days). Only the first three groups are cached offline |
| Who gets the app | Every user linked to a technician (`artists.user_id`) in the active org, whatever their role. Admins and office users with a technician link get a "Meine Einsätze" nav item |
| Office feedback | In-app notification to admins and office when a technician completes an order; dashboard marks orders completed by a technician |
| Default values in the UI | Every preset value gets a tooltip that explains it (owner rule) |

## Non-goals

- Time and material capture, office review of it, report PDF attached to the invoice (Teil 6b).
- Writing offline: a local outbox, background sync, conflict resolution.
- A native app, app store distribution, push notifications.
- Technicians assigning themselves to orders, seeing other technicians' orders, or seeing prices.
- Technicians reopening or cancelling orders.
- Editing a locked report, by anyone. Corrections are a new report or an office note.
- Sending the report to the customer by email.
- Scheduling, a calendar or route planning for the office.
- GPS tracking, check-in by location.
- English report PDFs; the PDF is German in V1 like every Werkbank document.
- Removing the Showflow domain (separate spec per ADR-0014).

## Reuse map

| Need | Existing piece | Use |
|---|---|---|
| Technician identity | `public.artists` (`user_id`, `org_id`, `name`), `werkbank.order_technicians` | The assignment check in every RPC and storage policy |
| Order status changes | `werkbank.order_transition()` (latest in `20261008110000_werkbank_invoice_logic.sql`), `nextOrderActions` / `ORDER_ACTION_TARGET` in `src/features/werkbank/lib/orderStatus.ts` | The technician RPCs update `status`; the trigger stays the only judge of transitions |
| Status display | `ORDER_STATUS_TONES`, `StatusPill` | Same tones in the app and on the office card |
| RPC conventions | `finalize_invoice`, `record_payment` (security definer, `set search_path = ''`, role check, row lock, SQLSTATE messages, `revoke all ... from public, anon`) | Same shape for the new RPCs |
| Lock trigger pattern | Teil 3 and 4 lock triggers on quotes, orders and invoices | Same pattern for `visit_reports` and `visit_report_photos` |
| Error mapping | `src/features/werkbank/lib/dbErrors.ts` (`mapDbError`) | New codes mapped to German and English copy |
| Private storage | Buckets `werkbank-documents` and `werkbank-assets`, org id as first path segment, policies in `20261007200000_werkbank_totals_storage.sql` | Same layout and policy shape for `werkbank-visits` |
| PDF on the edge | `_shared/werkbank/pdf/fonts.ts`, `sections.ts`, `quoteDocument.tsx`, `dunningDocument.tsx`; `_shared/werkbank/documentStorage.ts` (`logoDataUrl`) | Report document in the same letterhead and layout |
| Edge scaffolding | `werkbank-dunning/index.ts` (`handle(req, deps)`, `requireOrgRole`, `resolveOrgKind`) | Same structure in `werkbank-reports` |
| Notifications | `public.notifications` (`user_id`, `org_id`, `type`, `title`, `message`, `read`), `NotificationsList` | Inserted server-side by `complete_assignment` |
| Query persistence | `@tanstack/react-query` v5 already installed | Add `@tanstack/react-query-persist-client` (same major) |
| Office order page | `OrderPage.tsx`, `OrderScheduleCard.tsx` | New card below the schedule card |
| UI primitives | `PageHeader`, `StatusPill`, `EmptyState`, `Metric`, `Token`, `Eyebrow`, `Dialog`, `Sheet`, `Button` | No local versions |

New dependencies: `vite-plugin-pwa` (dev), `@tanstack/react-query-persist-client`, and `fake-indexeddb` (dev, tests only). Nothing else: the camera uses `<input type="file" capture>`, the signature pad uses canvas and pointer events, the cache uses native IndexedDB.

## Requirements

### R1. Tables (schema `werkbank`)

**`werkbank.visit_reports`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | FK `public.organizations` on delete cascade |
| `order_id` | uuid not null | FK `(org_id, order_id)` to `werkbank.orders (org_id, id)` on delete no action |
| `artist_id` | uuid null | FK `public.artists` on delete set null; the author |
| `technician_name` | text not null | Snapshot of the author's name at creation |
| `visit_date` | date not null | Default `(now() at time zone 'Europe/Berlin')::date` |
| `body` | text not null default '' | Free text, max 10 000 characters (check) |
| `locked_at` | timestamptz null | Set by lock or sign |
| `signer_name` | text null | Required when `signature_path` is set (check) |
| `signature_path` | text null | Object path in `werkbank-visits` |
| `signed_at` | timestamptz null | Set together with `signature_path` |
| `office_note` | text null | Internal; the only column writable after lock |
| `created_at`, `updated_at` | timestamptz | `update_updated_at_column()` trigger |

Constraints: `unique (org_id, id)`; signature columns all null or all set; a signed report is locked (`signed_at is null or locked_at is not null`).

**`werkbank.visit_report_photos`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `org_id` | uuid not null | FK organizations on delete cascade |
| `report_id` | uuid not null | FK `(org_id, report_id)` to `visit_reports` on delete cascade |
| `path` | text not null unique | Object path in `werkbank-visits` |
| `position` | int not null | Order in the report |
| `caption` | text null | Max 200 characters |
| `created_at` | timestamptz | |

**`werkbank.orders.completed_by`**: new column `uuid null` references `auth.users` on delete set null. `order_transition()` sets it to `auth.uid()` on the transition into `done` and clears it on reopen. Existing done orders keep null.

**Lock trigger.** On `visit_reports` before update: when `old.locked_at is not null`, every column except `office_note` and `updated_at` must be unchanged (SQLSTATE `WB601 report_locked`). Before delete: only an unlocked report without photos and with an empty body may be deleted (`WB602 report_not_empty`). On `visit_report_photos` before insert, update or delete: the parent report must be unlocked (`WB601`), except for the cascade from an org delete. A report on a `cancelled` or `invoiced` order cannot be created (`WB603 order_closed`); existing reports stay readable. An order with reports cannot be deleted (the FK raises; `mapDbError` maps it to "Der Auftrag hat Einsatzberichte und kann nicht gelöscht werden. Storniere ihn stattdessen.").

**RLS.** Both tables have RLS enabled.
- `select`: `admin` or `producer` of the org.
- `update` on `visit_reports`: `admin` or `producer`, and a column grant limits `authenticated` updates to `office_note`. Inserts, deletes and all photo writes have no table grant for `authenticated`; they go through the RPCs.
- Technicians read and write only through R2.

**Limits (defaults with tooltip, constants in `src/features/werkbank/lib/visitDefaults.ts` and mirrored in the RPC):** 20 photos per report, photo upload at most 5 MB after client-side resizing, signature PNG at most 500 KB.

### R2. RPCs (schema `werkbank`)

All are `security definer`, `set search_path = ''`, `revoke all ... from public, anon`, `grant execute ... to authenticated`. Every one resolves the caller's technician row as `artists where user_id = auth.uid() and org_id = <order's org>` and checks the assignment in `order_technicians` (`not_assigned`, same message for "not found" so ids cannot be probed). Errors are raised as messages with standard SQLSTATEs like Teil 3 to 5 (`not_assigned`/`not_author` 42501, `report_locked`/`report_not_empty`/`order_closed` 55000, `photo_missing`/`photo_limit`/`signer_required` 22023); the `WBxxx` codes below name the message (amended while planning).

| RPC | Effect |
|---|---|
| `my_technician_orgs()` | The org ids in which the caller has a technician row. Drives the nav item and the landing redirect |
| `my_assignments(p_org uuid)` | The caller's assigned orders in the org: id, order_no, status, scheduled_date, scheduled_time, subject, customer display name, property address (street, zip, city), group key (`overdue`, `today`, `upcoming`, `unscheduled`, `done`). `done` covers `done` and `invoiced` with `completed_at` in the last 14 days. `cancelled` is excluded. Today is Europe/Berlin. Upcoming is the next 7 days |
| `my_assignment(p_order uuid)` | One order: the fields above plus location note, notes, contact (name, phone, mobile, email), line items (position, title, description, quantity, unit, kind; no price, discount or total fields), co-technicians (names), and the order's visit reports with photo paths and signature data |
| `start_assignment(p_order uuid)` | `open` to `in_progress` |
| `complete_assignment(p_order uuid)` | `in_progress` to `done`; inserts one `notifications` row (`type = 'werkbank_order_completed'`, `related_entity_type = 'werkbank_order'`) for every `admin` and `producer` of the org except the caller |
| `create_visit_report(p_order uuid, p_visit_date date)` | New unlocked report; author = caller |
| `update_visit_report(p_report uuid, p_body text, p_visit_date date)` | Own unlocked report only (`WB604 not_author`) |
| `add_visit_photo(p_report uuid, p_path text, p_caption text)` | Registers an uploaded object. The path must start with `<org>/<order>/<report>/` and exist in `storage.objects` (`WB605 photo_missing`); enforces the photo limit (`WB606 photo_limit`) |
| `remove_visit_photo(p_photo uuid)` | Own unlocked report only; deletes the row. The object is deleted by the client after the RPC succeeds (best effort; an orphan is harmless and private) |
| `lock_visit_report(p_report uuid)` | Sets `locked_at` (close without signature) |
| `sign_visit_report(p_report uuid, p_signer_name text, p_signature_path text)` | Sets signer, path, `signed_at` and `locked_at` in one statement. Signer name is required and trimmed |

A technician can read every report on an order they are assigned to and change only their own. Removing a technician from an order removes their access to it; their reports stay.

### R3. Storage

New private bucket `werkbank-visits`. Path `<org_id>/<order_id>/<report_id>/<uuid>.jpg` for photos and `<org_id>/<order_id>/<report_id>/signature.png` for the signature.

Policies on `storage.objects`, built like the Teil 3 policies (cast the path segments only inside a `case` reached for this bucket and uuid-shaped segments):
- `select`: `admin` or `producer` of the org, or a technician assigned to the order (helper `werkbank.can_read_visit_object(name)`, security definer).
- `insert`: a technician assigned to the order whose report in the path is unlocked and authored by them (helper `werkbank.can_write_visit_object(name)`). `upsert` is not allowed, so a signature cannot be replaced.
- `delete`: same as insert. The office has no write access.
- No `update`.

### R4. Technician app (frontend, plugin paths)

**Routes.** `/einsaetze` (list) and `/einsaetze/:orderId` (detail with reports). Registered in `werkbankUi` with `requiredRoles: ['admin', 'producer', 'artist']` and guarded by a new `TechnicianRoute` wrapper inside the module: it shows the app when `my_technician_orgs()` contains the active org, otherwise an `EmptyState` ("Du bist in diesem Betrieb nicht als Monteur hinterlegt"). Both routes render in a `MobileShell` (module component): header with company logo, user name, sign out; no sidebar, no org switcher. Rendering a module page outside `AppLayout` needs an optional `shell?: 'app' | 'bare'` field on `ModuleRoute` in `src/modules/ui.ts` (default `'app'`), honoured in `App.tsx` where module routes are mapped: `'bare'` keeps `ProtectedRoute` and drops `AppLayout`. This is a kind-neutral core change and names no module.

**Landing.** A user whose only role in the active `handwerk` org is `artist` is redirected from the dashboard to `/einsaetze`. Implemented through the module dashboard slot (`WerkbankDashboard` renders `<Navigate to="/einsaetze">` for that case), so no core routing changes.

**Nav item.** "Meine Einsätze" (`werkbank:nav.myAssignments`), kinds `handwerk`, role `artist`. The core `NavItem` has no visibility predicate, so admins and office users who are also linked to a technician get a "Meine Einsätze" link in the Werkbank dashboard header instead (amended 2026-10-08 while planning).

**List screen.** Groups in this order: Überfällig, Heute, Nächste 7 Tage, Ohne Termin, Erledigt. Empty groups are hidden. Each card: time (`Metric`), customer, address, subject, `StatusPill`. Grouping is a pure function `groupAssignments(rows, today)` in `src/features/werkbank/lib/assignments.ts`, but the RPC's group key is authoritative; the function only orders and labels. No pull to refresh; queries refetch on mount and window focus.

**Detail screen.** Order number (`Token`), date, status. One primary button by status: "Arbeit beginnen" (`open`), "Als erledigt melden" (`in_progress`, confirm dialog), none otherwise. Address with "Route öffnen" (`https://www.google.com/maps/dir/?api=1&destination=<encoded address>`, opens the maps app on both platforms). Contact with `tel:` and `mailto:` links. Office notes, line items (quantity as `Metric`, unit, title, description), co-technicians. Reports newest first, with "Neuer Bericht".

**Report screen** (sheet over the detail). Visit date, text (saved on blur and on leaving the sheet), photos (add via `<input type="file" accept="image/*" capture="environment">`, resized in the browser to a 2000 px long edge as JPEG quality 0.8 using canvas, then uploaded and registered; remove per photo). Two closing actions, each with a confirm dialog that says the report cannot be changed afterwards:
- "Unterschreiben lassen": full-screen signature pad (canvas, pointer events, clear button), a required signer name field, and a read-only summary of the report text and photo count above the pad. Upload PNG, then `sign_visit_report`.
- "Ohne Unterschrift abschließen": `lock_visit_report`.

Locked reports render read-only with "Unterschrieben von X am …" or "Abgeschlossen am …".

**Touch targets.** Primary and list actions are at least 44 px high. If `Button` has no fitting size, add one there (`size="touch"`) and note it in `docs/ui-conventions.md` in the same PR.

**Install hint.** A dismissible card on the list screen when not running standalone (`display-mode: standalone` media query): on iOS a short instruction for "Zum Home-Bildschirm", elsewhere the browser's install prompt via `beforeinstallprompt`. Dismissal is a per-device `localStorage` flag, wrapped in try/catch.

**Page mini.** No mini for `/einsaetze`: the screen is a phone tool without room for an explainer card. The empty state explains the page instead ("Noch keine Einsätze. Sobald das Büro Dich einem Auftrag zuteilt, steht er hier.").

### R5. Offline reading

- `vite-plugin-pwa` with `generateSW`, `registerType: 'autoUpdate'`, scope and `navigateFallback` limited to `/einsaetze/`. Precache the app shell (index.html and built assets). No runtime caching of Supabase API calls in the service worker; data offline comes from the query cache below. The office pages are not controlled by the service worker.
- Web app manifest: name "Werkbank Digital", short name "Werkbank", `start_url` `/einsaetze`, `scope` `/einsaetze/`, `display: standalone`, icons from `public/werkbank/`.
- `PersistQueryClientProvider` (or `persistQueryClient` on the existing client) with a persister on native IndexedDB (`src/features/werkbank/lib/idbPersister.ts`, about 40 lines). `dehydrateOptions.shouldDehydrateQuery` keeps only `['werkbank', 'assignments', ...]` queries, and for the detail queries only orders in the groups `overdue`, `today`, `upcoming`. `maxAge` 7 days. The cache key includes the user id; a different user never reads another user's cache.
- After the list loads, the app prefetches `my_assignment` for each order in those three groups so the details are available offline.
- Photos and the signature image are shown from signed URLs and are not cached offline; offline they show a placeholder "Foto nur online".
- Offline banner from `navigator.onLine` and the `online`/`offline` events plus failed fetches: "Offline. Stand: 07:42" (time of the last successful list fetch). All write buttons are disabled offline with the hint "Braucht Netz".
- On sign out the IndexedDB store is deleted. The service worker precache holds only the app shell, which contains no customer data, so it stays.
- Residual cases (amended 2026-10-09 during review): a sign out from a tab that never opened the technician app, an expired session without a `SIGNED_OUT` event, or a store that does not answer within 2 s leaves the copy on the device until the technician app is opened next; that open first deletes other users' and expired entries. The copy is not encrypted at rest; it holds at most 7 days of the user's own assignments.

### R6. Office side

**Order page.** New `VisitReportsCard` below `OrderScheduleCard` on `OrderPage`: per report the date, technician, state (`StatusPill`: offen / abgeschlossen / unterschrieben), text, photo thumbnails (signed URLs, click opens a large view in a `Dialog`), signature image with signer and time, and an "Interne Notiz" field (saved on blur, `office_note`). Header button "Einsatzbericht als PDF" with a menu for one report or all reports of the order. The card is hidden when the order has no reports.

**Notification.** `werkbank_order_completed` renders in `NotificationsList` with a link to the order. Its title and message are written in German by the RPC (Werkbank is German first, like the documents); no new notification category settings.

**Dashboard.** A fourth tile "Vom Monteur gemeldet" counts orders in status `done` whose `completed_by` is a user linked to a technician (`order_list.completed_by_technician`) and links to the orders list filtered to them (amended 2026-10-08 while planning: the dashboard has no done list).

### R7. Edge function `werkbank-reports`

- `POST { org_id, order_id, report_ids?: uuid[] }`; default all locked and unlocked reports of the order, newest last.
- `requireOrgRole(org_id, ['admin', 'producer'])`, `resolveOrgKind` must be `handwerk`.
- Builds the PDF with the shared letterhead: company block and logo, title "Einsatzbericht", order number, customer, property address, line items with quantity and unit only, then per report the date, technician, text, photos in a two-column grid (downloaded via the service role, scaled), and the signature image with "Unterschrieben von X am …" or "Nicht unterschrieben". Unlocked reports carry a "Entwurf" marker.
- Returns the PDF bytes (`application/pdf`); stores nothing. Locked reports are immutable, so the PDF is reproducible.
- `[functions.werkbank-reports]` in `supabase/config.toml` with `verify_jwt = true`.
- Bundle size is checked against the upload limit in CI like `werkbank-invoices`.

### R8. Copy, help, changelog

- All strings in the `werkbank` namespace, EN and DE, Du-form, no dashes, no exclamation marks.
- Help items in `src/lib/help/items.ts` (EN + DE): "Wie sehen Monteure ihre Aufträge?", "Wie installiert ein Monteur die App auf dem Handy?", "Kann ich einen unterschriebenen Einsatzbericht ändern?".
- Role description for `artist` in `WERKBANK_ORG_KIND.roleDescriptions`: "Sieht die eigenen Aufträge, schreibt Einsatzberichte und meldet die Arbeit als erledigt." (EN accordingly).
- `public/changelog.md` entry and version 1.23.0 in `package.json` and `APP_META.VERSION`.

### R9. Default value tooltips

Every preset gets a tooltip through the existing `DefaultHint`: photo limit (20 per report), photo resizing (2000 px), offline window (today, overdue and the next 7 days), done list window (14 days), visit date default (today).

## Testing

- **pgTAP** (`supabase/tests/werkbank/visit_reports.test.sql`): a technician sees only assigned orders; `my_assignment` returns no price, discount or total keys; another org's technician and an unassigned technician get `WB600`; status transitions through the RPCs and `completed_by`; notification rows for admins and office but not the caller; lock trigger blocks every column but `office_note`; delete rules; photo limit; storage policies for read, insert, delete and the missing upsert; office cannot insert reports; RLS enabled and function grants (extends `isolation.test.sql` guards).
- **Vitest:** data access in `src/features/werkbank/data/visitReports.ts` with `supabaseFake`; hooks; `groupAssignments`; the persist filter (`shouldDehydrateQuery`); `idbPersister` against `fake-indexeddb` (new dev dependency, test only); the offline banner; the signature pad (draw, clear, empty pad blocks submit); the image resize helper with a stubbed canvas; `VisitReportsCard`; `TechnicianRoute`.
- **Deno:** `werkbank-reports` handler with `makeFakeDeps`: auth, wrong org kind, org boundary, report filter, PDF content markers (title, order number, signer).
- **E2E** (`e2e/werkbank-technician.spec.ts`, mobile viewport): office assigns a technician; technician signs in, lands on `/einsaetze`, starts the job, writes a report with one photo, signs, completes; office sees the notification and the report and downloads the PDF.

## Delivery

Three stacked PRs, each retargeted after the previous merge:

1. **Foundation:** migrations (tables, `completed_by` and the `order_transition` change, lock triggers, RPCs, bucket and policies), pgTAP, regenerated types and mirrors, `src/features/werkbank/data/visitReports.ts`, hooks, `mapDbError` codes.
2. **Technician app:** `MobileShell`, `TechnicianRoute`, routes and nav item, list, detail and report screens, signature pad, photo upload, PWA (`vite-plugin-pwa`, manifest), query persistence, install hint, offline banner, landing redirect.
3. **Office and PDF:** `VisitReportsCard`, notification rendering, dashboard marker, `werkbank-reports`, help items, role description, changelog and version, E2E.

## Open questions for the owner

None at the time of writing.
