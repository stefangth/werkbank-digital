# Werkbank Teil 6a: Technician app on site. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Technicians open Werkbank on the phone (installable PWA under `/einsaetze`, readable offline), see their assigned orders without prices, start and complete them, and write locked visit reports with photos and a customer signature; the office sees the reports on the order and downloads a PDF.

**Architecture:** Schema `werkbank` gains `visit_reports` and `visit_report_photos` plus `orders.completed_by`; technicians have no table grants and work only through SECURITY DEFINER RPCs that check `order_technicians`. Photos and signatures go to a new private bucket `werkbank-visits`. The app is a module route rendered in a bare `MobileShell`; `vite-plugin-pwa` (service worker scoped to `/einsaetze/`) and a React Query IndexedDB persister give offline reading. A new edge function `werkbank-reports` renders the report PDF with the shared letterhead.

**Tech Stack:** Postgres/pgTAP, Supabase Storage + Edge Functions (Deno, `@react-pdf/renderer`), React 18 + React Query v5, `vite-plugin-pwa`, `@tanstack/react-query-persist-client`, Vitest (+ `fake-indexeddb`), Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-werkbank-monteur-app-design.md` (R1 to R9). Teil 3 spec (`2026-10-07-werkbank-angebot-auftrag-design.md`) for orders and `order_transition`.

## Global Constraints

- CLAUDE.md "Reuse before you build" and the spec's Reuse map. No local copies of `mapDbError`, `fetchAllPages`, `StatusPill`, `ORDER_STATUS_TONES`, `DefaultHint`/`LabelWithHint`, the PDF letterhead (`SellerHeader`, `PageFooter`, `s`, `qty` from `_shared/werkbank/pdf/quoteDocument.tsx`, `UNIT_LABELS`/`buildSections` from `sections.ts`, `registerQuoteFonts`), `logoDataUrl`.
- Isolation: Werkbank code only in `src/features/werkbank/**`, `supabase/functions/werkbank-*/**`, `_shared/werkbank/**`, `supabase/migrations/*_werkbank_*.sql`, `supabase/tests/werkbank/**`, `public/werkbank/**`, `e2e/werkbank-*.spec.ts`, plus allow-listed touch points (`src/lib/notifications/entityRoutes.ts`, `src/lib/help/items.ts`, `supabase/functions/export-org-data/`). Core changes in this plan, all kind-neutral and naming no module: `src/modules/ui.ts` (`shell`), `src/App.tsx` (bare module routes), `src/components/ui/button.tsx` (`size="touch"`), `vite.config.ts` (PWA plugin with a scope passed in, no module name in core code beyond the manifest values below), `src/main.tsx` only if the persister must wrap the root. If `scripts/moduleIsolation.test.ts` flags `vite.config.ts` for the word "Werkbank" in the manifest, add an allow-list entry with the reason "PWA manifest name of the fork".
- Migrations: `20261008170000_werkbank_visit_reports.sql` (Task 1), `20261008180000_werkbank_visit_report_logic.sql` (Task 2). Never edit existing migrations; never apply to production by hand.
- Error messages raised in SQL (convention of Teil 3 to 5, NOT SQLSTATE `WB6xx` as the spec draft said; spec amended): `not_assigned` (42501), `not_author` (42501), `report_locked` (55000), `report_not_empty` (55000), `order_closed` (55000), `photo_missing` (22023), `photo_limit` (22023), `signer_required` (22023), `invalid_transition` (22023, existing). Each maps in `mapDbError` to a `werkbank` key `errors.<camelCase>`; a 23503 on constraint `visit_reports_order_fk` maps to `errors.orderHasReports`.
- RPC conventions: `security definer`, `set search_path = ''`, `revoke all ... from public, anon`, `grant execute ... to authenticated`. The caller's technician row is `public.artists where user_id = auth.uid() and org_id = <order org>`; `not_assigned` is raised for missing order and missing assignment alike.
- Assignment groups (exact strings): `overdue` (scheduled_date < Berlin today, status open|in_progress), `today`, `upcoming` (today+1 .. today+7), `unscheduled` (no date, open|in_progress), `done` (status done|invoiced, completed_at within 14 days). Cancelled orders never appear. Dates are Berlin dates: `(now() at time zone 'Europe/Berlin')::date` in SQL, `berlinDateKey` from `src/lib/dates.ts` in TS.
- Defaults (constants in `src/features/werkbank/lib/visitDefaults.ts`, each shown with a `DefaultHint`): `MAX_PHOTOS_PER_REPORT = 20`, `PHOTO_MAX_EDGE_PX = 2000`, `PHOTO_JPEG_QUALITY = 0.8`, `PHOTO_MAX_BYTES = 5 * 1024 * 1024`, `SIGNATURE_MAX_BYTES = 500 * 1024`, `UPCOMING_DAYS = 7`, `DONE_WINDOW_DAYS = 14`, `OFFLINE_MAX_AGE_MS = 7 days`. The SQL limit 20 is written as a literal with a comment pointing at this file.
- Storage: bucket `werkbank-visits`, private, `file_size_limit` 5 MB, `allowed_mime_types` `{image/jpeg,image/png}`. Paths `<org>/<order>/<report>/<uuid>.jpg` and `<org>/<order>/<report>/signature.png`. Signed URLs 300 s.
- Query keys: technician side `["werkbank", "assignments", userId, orgId]` (list) and `["werkbank", "assignments", userId, orgId, orderId]` (detail); office side `["werkbank", "visit-reports", orgId, orderId]`. Technician mutations invalidate `["werkbank", "assignments"]`; status changes also `["werkbank", "orders"]`; office note invalidates `["werkbank", "visit-reports"]`.
- Routes: `ASSIGNMENTS_PATH = "/einsaetze"`, `ASSIGNMENT_PATH = "/einsaetze/:orderId"` in `src/features/werkbank/paths.ts`.
- UI: `docs/ui-conventions.md`; order numbers `<Token>`, quantities and times `<Metric>`; tones from `ORDER_STATUS_TONES`/`TONES`; app copy in the `werkbank` namespace, EN and DE parity, Du-form, no em/en dashes, no exclamation marks; PDF German. Touch targets at least 44 px (`size="touch"` = `h-11`).
- Data layer: `fn(client, ...)` with `client.schema("werkbank").rpc(...)`; RPC results cast once at the boundary to explicit row interfaces.
- Edge: `export async function handle(req, deps, render = {...})`, `_shared/http.ts`, `_shared/auth.ts`, `resolveOrgKind`; tests with `makeFakeDeps`.
- Commit messages: imperative, lowercase, at most 72 chars, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- After each task: `npx vitest run <touched dirs>`, `npx tsc -p tsconfig.app.json --noEmit`, `npm run lint`; SQL tasks `npm run local:reset` then `supabase test db`; edge tasks `deno test --allow-all <dir>` and `deno check --node-modules-dir=none` on the touched function (restore `deno.lock` if `deno check` rewrote it). Before each PR: `npm run verify:fast` and `npm run sync:mirrors:check`.

## Review Focus

1. **Technician removed from the order, or the order cancelled, while the app has it cached:** the next fetch drops it from the list; an open detail page shows "Dieser Auftrag ist Dir nicht mehr zugeteilt" (on `not_assigned`) and the persisted entry is removed; a write fails with that message, never a generic error. Tests in Task 2 (RPC after `order_technicians` delete) and Task 6.
2. **Double tap on "Als erledigt melden" or "Unterschreiben" (two requests):** the second `complete_assignment` fails `invalid_transition` and the UI treats it as success after refetch (status already `done`); a second `sign_visit_report` fails `report_locked`, and the second signature upload fails on the existing object, so the stored signature is the first one. Exactly one notification per completion. Tests in Task 2 and Task 7.
3. **Upload succeeded, RPC failed (network drop between the two calls):** the object stays orphaned and invisible; a retry uploads a new uuid path and registers it; the photo count only counts registered rows. For the signature the retry reuses `signature.png`; when the upload answers "already exists" the client proceeds to `sign_visit_report`. Tests in Task 7 (`uploadVisitPhoto`/`signReport` with a fake storage that fails the second call).
4. **Persisted cache of another user on a shared phone:** user B signing in after user A sees none of A's orders, offline or online; sign out deletes the IndexedDB store. Tests in Task 8 (persister keyed by user id, `clearAssignmentCache` called from sign out).
5. **Midnight and time zones:** an order scheduled for Berlin today is in `today` at 00:30 Berlin (22:30 UTC the previous day), and in `overdue` the next day if not done. Test in Task 2 with `set local timezone 'UTC'` and a fixed `now()` via a test helper that overrides the date parameter (`my_assignments` takes an optional `p_today date default null` used only by tests).

---

## PR 1: Foundation (branch `feature/werkbank-teil6a-foundation`; rename `feature/werkbank-teil6a-spec`, which carries the spec and plan commits)

### Task 1: Tables, `completed_by`, lock triggers, RLS (R1)

**Files:**
- Create: `supabase/migrations/20261008170000_werkbank_visit_reports.sql`
- Create: `supabase/tests/werkbank/visit_reports.test.sql`
- Modify: `supabase/tests/werkbank/isolation.test.sql` only if its table lists are explicit

**Interfaces:**
- Produces: tables `werkbank.visit_reports`, `werkbank.visit_report_photos` (columns exactly as spec R1); `werkbank.orders.completed_by uuid references auth.users on delete set null`; view `werkbank.order_list` gains `completed_by` and `completed_by_technician boolean` (true when an `artists` row with `user_id = completed_by` exists in the order's org); constraint names `visit_reports_order_fk`, `visit_reports_signature_all_or_none`, `visit_reports_signed_is_locked`.

- [ ] **Step 1: Write the failing pgTAP test** `visit_reports.test.sql` with fixtures (org, admin, producer, artist user with artist row, order) asserting:
  - `has_table('werkbank','visit_reports')`, `has_table('werkbank','visit_report_photos')`, `has_column('werkbank','orders','completed_by')`, RLS enabled on both.
  - office (`producer`) `select` sees a report; artist user `select` sees 0 rows (`is_empty`); `authenticated` insert into `visit_reports` raises 42501 (no grant).
  - producer `update ... set office_note = 'x'` on a locked report succeeds; `update ... set body = 'y'` raises (column grant) .
  - as owner (fixture insert): updating `body` of a locked report raises `report_locked`; updating `office_note` passes; inserting a photo on a locked report raises `report_locked`; deleting an unlocked empty report passes; deleting an unlocked report with body raises `report_not_empty`.
  - inserting a report on a `cancelled` order raises `order_closed`; signature check constraints reject `signer_name` without `signature_path` and `signed_at` without `locked_at`.
  - `order_transition`: owner-context `in_progress -> done` under `set local request.jwt.claims` for the artist user sets `completed_by` to that user; `done -> in_progress` clears it; `done -> invoiced` keeps it; `completed_by` is not a lock-breaking change on a done order.
  - deleting an `open` order with a report raises 23503 naming `visit_reports_order_fk`.
  - `order_list.completed_by_technician` is true for that order.
- [ ] **Step 2: Run** `npm run local:reset && supabase test db` — expected: FAIL (tables missing).
- [ ] **Step 3: Write the migration.** Tables, constraints, indexes (`(org_id, order_id)`, `(report_id)`), `update_updated_at_column` trigger, lock trigger function `werkbank.visit_report_lock()` (one function for both tables, `tg_table_name` branch, FK cascade from org delete passes when the parent row is gone), RLS policies (select admin|producer; update admin|producer), `grant update (office_note) on werkbank.visit_reports to authenticated`, `revoke all on function ... from public, anon`. `create or replace function werkbank.order_transition()` copied from `20261008110000_werkbank_invoice_logic.sql` with three changes: set `new.completed_by := auth.uid()` on entry into `done` from `in_progress`, `null` on `done -> in_progress`, unchanged otherwise; add `'completed_by'` to the excluded keys of the done/invoiced lock check. Drop and recreate `werkbank.order_list` with the two new columns appended at the end, same grant.
- [ ] **Step 4: Run** `supabase test db` — expected: all werkbank tests PASS, including the existing `quote_order_logic` and `invoice_logic` ones.
- [ ] **Step 5: Commit** `add visit report tables and completed_by on orders`

### Task 2: Technician RPCs, notification, storage (R2, R3)

**Files:**
- Create: `supabase/migrations/20261008180000_werkbank_visit_report_logic.sql`
- Create: `supabase/tests/werkbank/visit_report_logic.test.sql`

**Interfaces:**
- Produces (all in schema `werkbank`, signatures exact):
  - `my_technician_orgs() returns setof uuid`
  - `my_assignments(p_org uuid, p_today date default null) returns table (id uuid, order_no text, status text, scheduled_date date, scheduled_time time, subject text, customer_name text, street text, postal_code text, city text, group_key text)`
  - `my_assignment(p_order uuid) returns jsonb` with keys `order` (the list fields plus `location_note`, `notes`, `org_id`), `contact` (`name`, `phone`, `mobile`, `email` or null), `items` (array of `position`, `title`, `description`, `quantity`, `unit`, `kind`), `technicians` (array of names), `reports` (array of report objects: `id`, `artist_id`, `technician_name`, `visit_date`, `body`, `locked_at`, `signer_name`, `signature_path`, `signed_at`, `is_mine`, `photos` array of `id`, `path`, `position`, `caption`). `office_note` is never included.
  - `start_assignment(p_order uuid) returns void`, `complete_assignment(p_order uuid) returns void`
  - `create_visit_report(p_order uuid, p_visit_date date default null) returns uuid`
  - `update_visit_report(p_report uuid, p_body text, p_visit_date date) returns void`
  - `add_visit_photo(p_report uuid, p_path text, p_caption text default null) returns uuid`
  - `remove_visit_photo(p_photo uuid) returns text` (the removed path, for the client to delete)
  - `lock_visit_report(p_report uuid) returns void`
  - `sign_visit_report(p_report uuid, p_signer_name text, p_signature_path text) returns void`
  - helpers `can_read_visit_object(p_name text) returns boolean`, `can_write_visit_object(p_name text) returns boolean`
  - notification row: `type 'werkbank_order_completed'`, `related_entity_type 'werkbank_order'`, `related_entity_id` = order id, `title 'Auftrag erledigt'`, `message '<technician name> hat Auftrag <order_no> als erledigt gemeldet.'`

- [ ] **Step 1: Write the failing pgTAP test** asserting, with fixtures of two orgs, two technicians (A assigned, B not), admin and producer:
  - `my_technician_orgs()` as A returns A's org; as producer without artist row returns nothing.
  - `my_assignments` as A returns only assigned orders, the five group keys for crafted orders (overdue, today, upcoming in 7 days, a date in 8 days absent, unscheduled, done 3 days ago, done 20 days ago absent, cancelled absent); with `set local timezone 'UTC'` and `p_today` = Berlin date the `today` row is correct.
  - `my_assignment` as A: `jsonb_object_keys(items->0)` has no key matching `%price%|%discount%|%total%|vat%`; `reports` has no `office_note`; as B raises `not_assigned`; for a random uuid raises `not_assigned`.
  - `start_assignment`/`complete_assignment` as A move the order and write `completed_by`; a second `complete_assignment` raises `invalid_transition`; one notification each for admin and producer, none for A.
  - report lifecycle as A: create, update, add photo (with a `storage.objects` fixture row), photo 21 raises `photo_limit`, unknown path raises `photo_missing`, path of another report raises `photo_missing`; B (assigned to the same order in a second fixture) updating A's report raises `not_author`; `lock_visit_report` then `update_visit_report` raises `report_locked`; `sign_visit_report` with blank name raises `signer_required`; sign sets `signed_at` and `locked_at`.
  - after `delete from werkbank.order_technicians` for A, every RPC on that order raises `not_assigned`.
  - storage policies via `set local role authenticated` + jwt claims: A can insert `<org>/<order>/<A's open report>/x.jpg`, cannot insert under a locked report, under B's report, or under another org; producer can select, cannot insert; B in another org cannot select.
  - every new function: `revoke` from `public`/`anon` checked via `has_function_privilege`.
- [ ] **Step 2: Run** `supabase test db` — expected: FAIL.
- [ ] **Step 3: Write the migration.** A private helper `werkbank.assigned_artist(p_order uuid) returns public.artists` (security definer, raises `not_assigned`) used by every RPC; rows locked with `for update` on the order (status RPCs) or report (report RPCs). Bucket insert with the limits from Global Constraints; storage policies built like those in `20261007200000_werkbank_totals_storage.sql` (segment cast only inside the `case` for this bucket and uuid-shaped segments) calling the two helpers; no update policy.
- [ ] **Step 4: Run** `supabase test db` — expected: PASS.
- [ ] **Step 5: Commit** `add technician rpcs and visit photo storage`

### Task 3: Types, export, data layer, hooks, pure helpers

**Files:**
- Modify: `src/integrations/supabase/types.ts` (regenerated: `supabase gen types typescript --local --schema public,graphql_public,werkbank`), then `npm run sync:mirrors`
- Modify: `supabase/functions/export-org-data/index.ts` (add `visit_reports`, `visit_report_photos` to the werkbank table list) and its test
- Create: `src/features/werkbank/lib/visitDefaults.ts`, `src/features/werkbank/lib/assignments.ts` (+ test)
- Create: `src/features/werkbank/data/technicianApp.ts` (+ test), `src/features/werkbank/data/visitReports.ts` (+ test)
- Create: `src/features/werkbank/hooks/useAssignments.ts` (+ test), `src/features/werkbank/hooks/useVisitReports.ts`
- Modify: `src/features/werkbank/lib/dbErrors.ts` (+ test), `src/features/werkbank/i18n/{en,de}.json` (error keys)
- Modify: `src/lib/notifications/entityRoutes.ts` (+ test): `case "werkbank_order": return id ? \`/orders/${id}\` : null`

**Interfaces:**
- Produces:
  - `type GroupKey = "overdue" | "today" | "upcoming" | "unscheduled" | "done"`; `const GROUP_ORDER: GroupKey[]`; `groupAssignments(rows: AssignmentRow[]): { key: GroupKey; rows: AssignmentRow[] }[]` (order of `GROUP_ORDER`, empty groups dropped, rows by date then time then order_no); `isOfflineGroup(key: GroupKey): boolean` (true for overdue, today, upcoming).
  - `technicianApp.ts`: `AssignmentRow` (the `my_assignments` columns), `AssignmentDetail` (typed `my_assignment` jsonb), `fetchTechnicianOrgs(client): Promise<string[]>`, `fetchAssignments(client, orgId): Promise<AssignmentRow[]>`, `fetchAssignment(client, orderId): Promise<AssignmentDetail>`, `startAssignment(client, orderId)`, `completeAssignment(client, orderId)`, `createVisitReport(client, orderId, visitDate?: string): Promise<string>`, `updateVisitReport(client, reportId, body, visitDate)`, `uploadVisitPhoto(client, { orgId, orderId, reportId, file: Blob, caption? }): Promise<string>` (upload `upsert: false` then `add_visit_photo`), `removeVisitPhoto(client, photoId)` (RPC then best-effort storage remove), `lockVisitReport(client, reportId)`, `signVisitReport(client, { orgId, orderId, reportId, signerName, png: Blob })` (upload `signature.png`, treat "already exists" as uploaded, then RPC), `visitObjectUrls(client, paths: string[]): Promise<Record<string, string>>` (signed URLs, 300 s).
  - `visitReports.ts` (office): `VisitReport` (table row + `photos`), `fetchVisitReports(client, orgId, orderId): Promise<VisitReport[]>`, `updateOfficeNote(client, reportId, note: string | null)`.
  - hooks: `useTechnicianOrgs()`, `useIsTechnicianHere(): boolean | undefined`, `useAssignments()`, `useAssignment(orderId)`, `useAssignmentActions(orderId)` (start, complete, createReport, updateReport, addPhoto, removePhoto, lockReport, signReport; each a mutation with the invalidations from Global Constraints and `toast.error(t(mapDbError(e)))`), `useVisitReports(orderId)`, `useUpdateOfficeNote(orderId)`.

- [ ] **Step 1: Write failing tests:** `assignments.test.ts` (ordering, empty groups dropped, `isOfflineGroup`); `technicianApp.test.ts` with `supabaseFake` (RPC names and args; `uploadVisitPhoto` path shape `<org>/<order>/<report>/<uuid>.jpg` and `upsert: false`; `signVisitReport` continues on an "already exists" upload error and rethrows other upload errors; `removeVisitPhoto` removes the returned path); `visitReports.test.ts`; `dbErrors.test.ts` for each new message and for 23503 on `visit_reports_order_fk` → `errors.orderHasReports` (and 23503 elsewhere still `errors.inUse`); `entityRoutes.test.ts` for `werkbank_order`; `useAssignments.test.tsx` (query keys include user id and org id; disabled without org).
- [ ] **Step 2: Run** `npx vitest run src/features/werkbank src/lib/notifications` — expected: FAIL.
- [ ] **Step 3: Implement** the files above; add the error keys with EN and DE copy (DE: `notAssigned` "Dieser Auftrag ist Dir nicht mehr zugeteilt.", `reportLocked` "Der Bericht ist abgeschlossen und kann nicht mehr geändert werden.", `orderHasReports` "Der Auftrag hat Einsatzberichte und kann nicht gelöscht werden. Storniere ihn stattdessen.", others in the same voice).
- [ ] **Step 4: Run** vitest, `tsc`, `lint`, `npm run sync:mirrors:check`, `deno test --allow-all supabase/functions/export-org-data` — expected: PASS.
- [ ] **Step 5: Commit** `add technician app data layer and hooks`

**Open PR 1** (base `main`): "Werkbank Teil 6a, PR 1: visit reports foundation".

---

## PR 2: Technician app (branch `feature/werkbank-teil6a-app`, from PR 1)

### Task 4: Bare module routes, shell, guard, nav, landing

**Files:**
- Modify: `src/modules/ui.ts` (`ModuleRoute.shell?: "app" | "bare"`), `src/App.tsx` (bare routes skip `AppLayout`), `src/components/ui/button.tsx` (+ test, `size: touch: "h-11 rounded-control px-4 text-body [&_svg]:size-5"`), `docs/ui-conventions.md` (one line on `touch`)
- Modify: `src/features/werkbank/paths.ts`, `src/features/werkbank/ui.ts`, `src/features/werkbank/components/WerkbankDashboard.tsx` (+ test)
- Create: `src/features/werkbank/app/MobileShell.tsx`, `src/features/werkbank/app/TechnicianRoute.tsx` (+ tests)

**Interfaces:**
- Consumes: `useIsTechnicianHere`, `useTechnicianOrgs` (Task 3).
- Produces: `<MobileShell title?: string back?: string>{children}</MobileShell>`; `<TechnicianRoute>{children}</TechnicianRoute>`; routes `ASSIGNMENTS_PATH`, `ASSIGNMENT_PATH` with `shell: "bare"`, `kinds: ["handwerk"]`, `requiredRoles: ["admin", "producer", "artist"]`; nav item `werkbank:nav.myAssignments` (icon `HardHat`, `roles: ["artist"]`, `kinds: ["handwerk"]`). The core `NavItem` has no visibility predicate, so office users who are also technicians get a "Meine Einsätze" link in the `WerkbankDashboard` header instead of a nav item (spec R4 amended; no core change).

- [ ] **Step 1: Write failing tests:** `App` route test that a module route with `shell: "bare"` renders without the sidebar landmark; `TechnicianRoute` renders children when the active org is in `my_technician_orgs`, the `EmptyState` ("Du bist in diesem Betrieb nicht als Monteur hinterlegt.") otherwise, a skeleton while loading; `WerkbankDashboard` redirects a user whose only role is `artist` to `/einsaetze` and shows the "Meine Einsätze" link for an admin who is a technician; `button.test.tsx` for `size="touch"` height class.
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement.** `MobileShell`: header with company logo (existing `useCompanyProfile` logo URL hook), user name, sign out button; `main` with `px-4 pb-24` and `max-w-screen-sm mx-auto`; no sidebar, no org switcher.
- [ ] **Step 4: Run** vitest, `tsc`, `lint` (including `scripts/moduleIsolation.test.ts`) — expected: PASS.
- [ ] **Step 5: Commit** `add bare module routes and technician shell`

### Task 5: Assignment list and install hint

**Files:**
- Create: `src/features/werkbank/app/AssignmentsPage.tsx` (+ test), `src/features/werkbank/app/AssignmentCard.tsx`, `src/features/werkbank/app/InstallHint.tsx` (+ test)
- Modify: `src/features/werkbank/i18n/{en,de}.json` (`app.*` keys)

**Interfaces:**
- Consumes: `useAssignments`, `groupAssignments`, `ORDER_STATUS_TONES`.
- Produces: default-loaded page for `ASSIGNMENTS_PATH` (`loadAssignmentsPage` in `ui.ts`).

- [ ] **Step 1: Write failing tests:** groups render in order with headings "Überfällig", "Heute", "Nächste 7 Tage", "Ohne Termin", "Erledigt" (the last two carry `DefaultHint`s for 7 and 14 days); a card shows time as `Metric`, customer, address, subject, status pill and links to `/einsaetze/<id>`; empty list shows the `EmptyState` copy from spec R4; error shows `Alert`; `InstallHint` hidden when `matchMedia('(display-mode: standalone)')` matches or the dismiss flag is set, shows iOS instructions for an iOS user agent, calls the stored `beforeinstallprompt` event's `prompt()` elsewhere, survives a throwing `localStorage`.
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected: PASS.
- [ ] **Step 5: Commit** `add technician assignment list`

### Task 6: Assignment detail, start and complete

**Files:**
- Create: `src/features/werkbank/app/AssignmentPage.tsx` (+ test), `src/features/werkbank/app/mapsLink.ts` (+ test)

**Interfaces:**
- Consumes: `useAssignment`, `useAssignmentActions`. Reports render as read-only summaries here; Task 7 adds the sheet.
- Produces: `mapsLink(address: { street?: string | null; postal_code?: string | null; city?: string | null }): string | null` returning `https://www.google.com/maps/dir/?api=1&destination=<encodeURIComponent("street, zip city")>`, null without street and city.

- [ ] **Step 1: Write failing tests:** header shows `<Token>` order number, date, status; "Arbeit beginnen" calls `start_assignment` for `open`; "Als erledigt melden" opens a confirm dialog and calls `complete_assignment` for `in_progress`; no action for `done`; a failed `complete_assignment` with `invalid_transition` refetches and, if the order is now `done`, shows no error toast; a `not_assigned` error shows the `errors.notAssigned` copy with a link back to the list; contact renders `tel:` and `mailto:` links; line items show quantity as `Metric` and no price text; `mapsLink` cases (full address, missing street, umlauts encoded).
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected: PASS.
- [ ] **Step 5: Commit** `add technician assignment detail`

### Task 7: Visit report sheet, photos, signature

**Files:**
- Create: `src/features/werkbank/app/ReportSheet.tsx` (+ test), `src/features/werkbank/app/SignaturePad.tsx` (+ test), `src/features/werkbank/lib/resizeImage.ts` (+ test)
- Modify: `src/features/werkbank/app/AssignmentPage.tsx` ("Neuer Bericht", report list opens the sheet)

**Interfaces:**
- Consumes: `useAssignmentActions`, `visitObjectUrls`, `visitDefaults`.
- Produces: `resizeImage(file: Blob, maxEdge = PHOTO_MAX_EDGE_PX, quality = PHOTO_JPEG_QUALITY): Promise<Blob>` (canvas, JPEG; rejects when the result exceeds `PHOTO_MAX_BYTES`); `<SignaturePad onChange={(png: Blob | null) => void} />` (canvas, pointer events, "Löschen" button, `null` while empty).

- [ ] **Step 1: Write failing tests:** `resizeImage` with a stubbed canvas scales a 4000×3000 image to 2000×1500 and keeps 1200×800 unchanged; over-limit result rejects. `SignaturePad` emits `null` initially, a blob after a pointer stroke, `null` after "Löschen". `ReportSheet`: body saves on blur via `update_visit_report`; adding a photo calls `resizeImage` then `uploadVisitPhoto`; the add button is disabled at 20 photos; `DefaultHint`s sit next to the photo limit, the resize note ("Fotos werden auf 2000 px verkleinert") and the visit date (default today); "Unterschreiben lassen" requires a non-blank signer name and a drawn signature, shows the text summary and photo count, confirms, then calls `signVisitReport`; "Ohne Unterschrift abschließen" confirms and calls `lockVisitReport`; a locked report renders read-only with "Unterschrieben von <Name> am <Datum>" or "Abgeschlossen am <Datum>"; another technician's open report renders read-only; a double tap on the final confirm sends one request (button disabled while pending).
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected: PASS.
- [ ] **Step 5: Commit** `add visit report sheet with photos and signature`

### Task 8: PWA and offline reading (R5)

**Files:**
- Modify: `package.json`/`package-lock.json` (`npm install -D vite-plugin-pwa fake-indexeddb`, `npm install @tanstack/react-query-persist-client` pinned to the installed `@tanstack/react-query` major), `vite.config.ts`
- Create: `public/werkbank/icon-192.png`, `public/werkbank/icon-512.png` (rendered from `public/werkbank/mark.svg`)
- Create: `src/features/werkbank/lib/idbPersister.ts` (+ test), `src/features/werkbank/app/OfflineBanner.tsx` (+ test), `src/features/werkbank/app/AssignmentCacheProvider.tsx` (+ test)
- Modify: `src/features/werkbank/app/MobileShell.tsx` (banner, provider, sign out clears cache), `src/features/werkbank/hooks/useAssignments.ts` (prefetch details of offline groups; `networkMode: "offlineFirst"`; write mutations disabled offline)

**Interfaces:**
- Produces: `createIdbPersister(key: string): Persister` (native IndexedDB, db `werkbank-cache`, store `queries`); `clearAssignmentCache(userId: string): Promise<void>`; `shouldPersistQuery(query, offlineOrderIds: Set<string>): boolean` (true for the list key and for detail keys whose order id is in the set); `useOnline(): { online: boolean; lastSync: Date | null }`.
- vite: `VitePWA({ registerType: "autoUpdate", strategies: "generateSW", scope: "/einsaetze/", manifest: { name: "Werkbank Digital", short_name: "Werkbank", start_url: "/einsaetze", scope: "/einsaetze/", display: "standalone", icons: [...] }, workbox: { navigateFallback: "/index.html", navigateFallbackAllowlist: [/^\/einsaetze/], runtimeCaching: [] } })`; registration happens in `AssignmentCacheProvider` (`virtual:pwa-register`), not globally, so office pages never register it.

- [ ] **Step 1: Write failing tests:** `idbPersister` round trip with `fake-indexeddb`, separate keys per user, `clearAssignmentCache` removes only that user's entry; `shouldPersistQuery` keeps the list and offline-group details, drops `done`/`unscheduled` details and every non-assignment key; `OfflineBanner` shows "Offline. Stand: 07:42" after an `offline` event with a last sync time, hides on `online`; write buttons render disabled with "Braucht Netz" when offline (one test on `AssignmentPage`); sign out calls `clearAssignmentCache` before `signOut`.
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement.** Wrap only the technician routes in `PersistQueryClientProvider`-equivalent `persistQueryClient` subscription on the existing client (`maxAge: OFFLINE_MAX_AGE_MS`, `buster` = app version), started in `AssignmentCacheProvider` with the user id.
- [ ] **Step 4: Run** vitest, `tsc`, `lint`, `npm run build` (check `dist/sw.js` exists and `dist/manifest.webmanifest` has scope `/einsaetze/`) — expected: PASS.
- [ ] **Step 5: Manual check in the preview:** start the dev server (`preview_start`), sign in as the seeded technician, open `/einsaetze`, set the browser offline, reload, see the cached list and banner. Note the result in the PR.
- [ ] **Step 6: Commit** `add offline reading for the technician app`

**Open PR 2** (base PR 1): "Werkbank Teil 6a, PR 2: technician app". `supabase/seed.sql` has no handwerk org; the E2E fixture of Task 11 creates the technician user, artist row and assignment, as the earlier `e2e/werkbank-*.spec.ts` files do for their data.

---

## PR 3: Office and PDF (branch `feature/werkbank-teil6a-office`, from PR 2)

### Task 9: Reports on the order page, dashboard tile

**Files:**
- Create: `src/features/werkbank/components/VisitReportsCard.tsx` (+ test)
- Modify: `src/features/werkbank/pages/OrderPage.tsx` (+ test), `src/features/werkbank/components/WerkbankDashboard.tsx` (+ test), `src/features/werkbank/pages/OrdersPage.tsx` (`?byTechnician=1` filter)

**Interfaces:**
- Consumes: `useVisitReports`, `useUpdateOfficeNote`, `visitObjectUrls`, `order_list.completed_by_technician`.
- Produces: `<VisitReportsCard orderId orgId />`; `downloadReportPdf` button slot filled in Task 10.

The dashboard tile follows amended spec R6: a fourth tile "Vom Monteur gemeldet" counting orders with `status = 'done'` and `completed_by_technician`, linking to `/orders?status=done&byTechnician=1`.

- [ ] **Step 1: Write failing tests:** card hidden without reports; per report date, technician, state pill (offen / abgeschlossen / unterschrieben), text, thumbnails from signed URLs opening a `Dialog`, signature with signer and time; "Interne Notiz" saves on blur via `updateOfficeNote` and shows `errors.*` on failure; dashboard tile count and link; orders list filter `byTechnician=1`.
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected: PASS.
- [ ] **Step 5: Commit** `show visit reports on the order page`

### Task 10: `werkbank-reports` edge function and PDF (R7)

**Files:**
- Create: `supabase/functions/_shared/werkbank/pdf/visitReportData.ts` (+ test), `supabase/functions/_shared/werkbank/pdf/visitReportDocument.tsx` (+ test)
- Create: `supabase/functions/werkbank-reports/index.ts` (+ `index.test.ts`)
- Modify: `supabase/config.toml` (`[functions.werkbank-reports] verify_jwt = true`), `src/features/werkbank/data/visitReports.ts` (+ test: `downloadVisitReportPdf(client, { orgId, orderId, reportIds? }): Promise<Blob>` via `functions.invoke`), `VisitReportsCard.tsx` (button with menu "Alle Berichte" / per report, opens the blob with the existing `pdfTab.ts` helper)

**Interfaces:**
- Produces: `loadVisitReportData(admin, orgId, orderId, reportIds?): Promise<VisitReportPdfData | null>` (seller from `company_profiles`, order header, items via `buildSections` with prices dropped, reports newest last, photos and signature as data URLs downloaded with the service role); `renderVisitReportPdf(data): Promise<Uint8Array>`; `handle(req, deps, render = { renderVisitReportPdf })`: 400 bad JSON, 401/403 from `requireOrgRole(['admin','producer'])`, 404 non-handwerk org or unknown order, 200 `application/pdf`.

- [ ] **Step 1: Write failing tests:** data loader with `makeFakeDeps` (rows for another org are not returned; `report_ids` filter; unlocked report flagged as draft); document test renders and contains "Einsatzbericht", the order number, "Unterschrieben von", "Entwurf" for an unlocked report, and no "€"; handler tests for the status codes above.
- [ ] **Step 2: Run** `deno test --allow-all supabase/functions/werkbank-reports supabase/functions/_shared/werkbank/pdf` — expected: FAIL.
- [ ] **Step 3: Implement** reusing `SellerHeader`, `PageFooter`, `s`, `qty`, `UNIT_LABELS`, `registerQuoteFonts`, `logoDataUrl`.
- [ ] **Step 4: Run** deno tests, `deno check --node-modules-dir=none supabase/functions/werkbank-reports/index.ts`, vitest for the client — expected: PASS. Check bundle size with `supabase functions deploy --dry-run` equivalent used in CI (`.github/workflows/ci.yml`) if present.
- [ ] **Step 5: Commit** `add visit report pdf`

### Task 11: Help, role description, changelog, end to end

**Files:**
- Modify: `src/lib/help/items.ts` (three items W6.1 to W6.3, `kinds: ['handwerk']`, EN + DE, Du), `src/features/werkbank/registry.ts` (`roleDescriptions.artist` EN/DE per spec R8; mirror via `npm run sync:mirrors`), `public/changelog.md` + `deno run --allow-read --allow-write scripts/changelog-to-json.ts`, `package.json` and `src/config/app.config.ts` version `1.23.0`
- Create: `e2e/werkbank-technician.spec.ts`

- [ ] **Step 1: Write the E2E test** (mobile viewport 390×844): office assigns a technician to an order; technician signs in, lands on `/einsaetze`, opens the order, starts it, creates a report with text and one photo (fixture JPEG via `setInputFiles`), signs with a drawn stroke and a name, completes the order; office sees the notification, opens the order, sees the signed report, downloads the PDF (response `application/pdf`).
- [ ] **Step 2: Run** `npx playwright test --config=e2e/playwright.config.ts e2e/werkbank-technician.spec.ts` against `npm run local:reset` — expected: PASS after Steps 3 and 4 if anything is missing.
- [ ] **Step 3: Add help items, role description, changelog block** (`## 1.23.0 — Oct 8, 2026` style as existing entries, *theme* "Monteure vor Ort", `### New` bullets for the technician app, visit reports with signature, report PDF; no super-admin mentions).
- [ ] **Step 4: Run** `npm run verify:fast`, `npm run sync:mirrors:check`, `npx vitest run src/i18n src/lib/help` — expected: PASS.
- [ ] **Step 5: Commit** `add technician app help, changelog and e2e`

**Open PR 3** (base PR 2): "Werkbank Teil 6a, PR 3: office reports, PDF, help, e2e". PR description: "No mini." for `/einsaetze` with the reason from spec R4; help center impact listed.
