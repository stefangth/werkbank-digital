# Werkbank Teil 1: Foundation (org kind `handwerk`, brand, kind-aware surface, isolation). Spec

**Date:** 2026-10-06
**Status:** Approved (owner, 2026-10-06).
**Decision record:** [ADR-0013](../../adr/0013-werkbank-as-removable-module.md) (why a module inside Showflow, the isolation model, removal and extraction).
**Related:** `2026-09-14-org-kind-workspace-type-design.md` (org kind and vocabulary, which this extends), `2026-08-15-i18n-server-side-per-org.md` (per-org language for emails and PDFs).

---

## Problem

Werkbank Digital is a back-office product for trade businesses that runs inside Showflow
(ADR-0013). Today an org can only be a live production or a staffing agency, every org sees
the Showflow navigation and brand, `provision_org` always seeds the Showflow starter
catalog, and role names describe show business. A pilot trade business with German-speaking
office staff and technicians must be able to sign in and see Werkbank, and nothing of
Showflow's booking product, before Teil 2 adds any business data.

Teil 1 builds that foundation and the isolation that keeps Werkbank removable.

## Decision summary (locked with the owner)

| Question | Decision |
|---|---|
| Placement | Module inside Showflow, removable by construction (ADR-0013) |
| Surface | **Approach A:** the org kind drives the existing shell. Navigation, routes, dashboard and settings tabs are filtered per kind. No second route tree or layout. |
| Kind | New org kind `handwerk`, label "Handwerksbetrieb" (EN "Trade business") |
| Roles | DB roles unchanged. Displayed as Admin, Büro (EN Office), Monteur (EN Technician) |
| Brand | Brand registry. Signed in: by org kind. Before sign-in: by invitation, then by host. Showflow is the fallback. Werkbank has no domain yet. |
| Invitation | `exchange-invitation` additionally returns the inviting org's brand key for a valid token |
| Kind switching | Into or out of `handwerk` only by a super-admin |
| Switch | No entitlement in V1. The org kind is the switch; only super-admins can create `handwerk` orgs. |
| Technicians | Technician = existing `artist` role plus `artists` row, created and invited from a new Werkbank page |
| Chats | Hidden for `handwerk` (chats are bound to `show_dates`) |
| Data | Werkbank tables live in a dedicated Postgres schema `werkbank`, created in Teil 1 |

## Non-goals

- Business data: customers, properties, catalog, quotes, orders, invoices (Teil 2 to 5).
- The mobile technician view (Teil 6), qualifications and absences for technicians.
- A Werkbank domain, mail sender domain or landing page (planned for, configured later; see Go-live checklist).
- Per-business white-labelling or custom domains.
- Entitlements or pricing tiers for Werkbank.
- Changing behaviour of `production` or `staffing` orgs. Every core extension point must leave their output unchanged.

## Isolation model

Every change in this spec belongs to exactly one of two categories (ADR-0013).

**Core extension points** (no Werkbank names, kept if Werkbank is removed): R2, R3 (mechanism), R4 (mechanism), R5, R6 (mechanism), R9.

**Werkbank plugin** (deleted or moved on removal or extraction): R1 entries, R3 values, R4 brand, R6 defaults, R7, R8.

Allowed plugin paths:

- `src/features/werkbank/**`
- `supabase/functions/werkbank-*/**`, `supabase/functions/_shared/werkbank/**`
- `supabase/migrations/*_werkbank_*.sql`, `supabase/tests/werkbank/**`
- the Werkbank lines in the manifests `src/modules/registry.ts`, `src/modules/i18n.ts`, `src/modules/ui.ts` and `supabase/functions/_shared/modules.ts`
- `public/werkbank/**` (logo, favicon, email mark), `e2e/werkbank-*.spec.ts`
- `docs/**`, the Werkbank section in `CLAUDE.md`, and entries in `scripts/mirrors.manifest.json` that point at plugin paths

Core files that must name the module and are therefore allowed explicitly (each is edited on removal or extraction): the `werkbank` entry in `supabase/config.toml` `[api] schemas`, the generated types (`src/integrations/supabase/types.ts` and its edge mirror `_shared/database.types.ts`), the Werkbank boundary rules in `eslint.config.js`, and the allow-list in `scripts/moduleIsolation.test.ts` itself.

## Requirements

### R1. Module manifest

- The client manifest is split in three files so that pure data never imports React (a single manifest would create an import cycle through `orgKind.ts` and `app.config.ts`):
  - `src/modules/registry.ts`: pure data. Org kind definitions (R2, R3), brands (R4).
  - `src/modules/i18n.ts`: i18n namespaces as JSON.
  - `src/modules/ui.ts`: React contributions. Navigation items, routes, dashboards per kind (R5).
- The edge manifest `supabase/functions/_shared/modules.ts` holds org kinds, brands and provisioning defaults (R6).
- The Werkbank plugin exposes `src/features/werkbank/registry.ts` (pure data with zero imports, file-mode mirrored to `_shared/werkbank/registry.ts`), `src/features/werkbank/i18n/{en,de}.json` and `src/features/werkbank/ui.ts`. Registering it is one import plus one array entry per manifest file.
- The core reads modules only through registries built from the manifests; no other core file imports from `src/features/werkbank`.

### R2. Org kinds as data

- New table `public.org_kinds (kind text primary key, seeds_starter_catalog boolean not null, switchable_by_org_admin boolean not null)`. RLS enabled, readable by `authenticated`, writable by no client role.
- The core migration inserts `('production', true, true)` and `('staffing', true, true)`, replaces `organizations_org_kind_check` with a foreign key `organizations.org_kind → org_kinds.kind`, and rewrites `provision_org` to validate the kind against the table and to call `seed_org_starter_catalog` only when `seeds_starter_catalog` is true. No string literal of a kind remains in `provision_org`.
- A `BEFORE UPDATE OF org_kind` trigger on `organizations` rejects a change when either the old or the new kind has `switchable_by_org_admin = false` and the caller is not a super-admin (`is_super_admin(auth.uid())`). Service-role callers pass.
- The workspace-type pickers (spec 2026-09-14, R7) list only kinds that are switchable by org admins, except in the super-admin surfaces (Platform: new org, edit org), which list all kinds. The current owner rule "anywhere, anytime" still holds for `production` and `staffing`.
- TypeScript: `OrgKind` becomes `CoreOrgKind | ModuleOrgKind`, where `CoreOrgKind = "production" | "staffing"` stays in `src/lib/orgKind.ts` and `ModuleOrgKind` is derived from the kinds contributed through `MODULES`. `ORG_KINDS`, `ORG_KIND_LABELS`, `VOCABULARY`, `isOrgKind` and `coerceOrgKind` are composed from core plus module entries. The mirrored block in `orgKind.ts` must keep importing nothing; the module entries are imported outside the sentinel block in each runtime (implementation plan settles the exact mirror wiring).

### R3. Vocabulary and role labels for `handwerk`

- The plugin supplies the full `Vocabulary` table for `en` and `de` (the existing key-completeness test applies unchanged). Approved values:

| Key family | DE | EN |
|---|---|---|
| show | Auftrag / Aufträge | job / jobs |
| showDate | Einsatz / Einsätze | assignment / assignments |
| artist | Monteur / Monteure | technician / technicians |
| production | Kunde / Kunden | customer / customers |
| cast | Team / Teams | team / teams |
| understudy | Vertretung / Vertretungen | substitute / substitutes |
| skill | Qualifikation / Qualifikationen | qualification / qualifications |
| hireOrder | Auftragsbestätigung / Auftragsbestätigungen | order confirmation / order confirmations |
| roleProducer | Büro | Office |
| kind | handwerk | handwerk |

  Capitalised forms follow the existing four-form rule.
- New vocabulary key `roleArtist`, used by `roleLabel` and the role-description templates for the `artist` role. `handwerk`: DE "Monteur", EN "Technician". The key-completeness rule forces a value for the existing kinds too; per the non-goals it is `"Artist"` for `production` and `staffing`, so their output stays exactly as today.
- Role labels in the UI language. `roleLabel(role, kind, lang)` and `roleDescription(role, kind, lang)` gain a `lang` argument, and the shared surfaces that render roles (People pane, invitations, accept-invite) pass the UI language. A kind definition carries `roleLabelsFollowUiLanguage`: `true` for `handwerk`, so the pilot reads "Büro" and "Monteur" in German; `false` for `production` and `staffing`, which keep today's English-only labels unchanged.
- `ORG_KIND_LABELS.handwerk`: DE "Handwerksbetrieb", "Kunden, Aufträge, Monteure und Rechnungen."; EN "Trade business", "Customers, jobs, technicians and invoices."
- The `admin` label stays "Admin" for every kind.

### R4. Brand registry

- Core `src/lib/brand.ts` (mirrored to `_shared/brand.ts` as a sentinel block) defines `BrandDef { key, name, logo, appUrl: string | null, hosts: string[], defaultFrom: string | null }` and composes `BRANDS` from the core `showflow` brand plus module brands. Each org kind maps to a brand; unknown kinds map to `showflow`.
- Resolution order in the client:
  1. signed in with an active org: the org kind's brand;
  2. otherwise a brand hint stored in `sessionStorage` by the invitation flow;
  3. otherwise the brand whose `hosts` contain `location.hostname`;
  4. otherwise `showflow`.
- Brand-dependent client surfaces: the shell name and logo (today `APP_META.NAME` and `StageMark`), document title, favicon, and the pre-login pages (Login, Reset password, Accept invite, Auth callback, No org).
- `exchange-invitation` returns `{ action_url, brand }` on success, where `brand` is the brand key of the invitation's org kind. Every error path is unchanged, so the endpoint reveals nothing new for invalid tokens. `AcceptInvitePage` stores `brand` as the session hint before redirecting.
- Edge: links in emails are built from the brand's `appUrl` when set, else `APP_URL`. The email header logo follows the brand. The sender stays the per-org setting; when unset, the brand's `defaultFrom` applies before the platform default.
- The Werkbank brand (plugin): name "Werkbank Digital", its logo asset, `appUrl: null`, `hosts: []`, `defaultFrom: null` until the domain exists.

### R5. Kind-aware surface

- `NavItem` gains `kinds?: OrgKind[]`. A kind filter hides an item (entitlements keep greying out). Items without `kinds` show for every kind.
- Existing items Get running, Dates, Hire orders, Availability, Chats, Productions, Artists and Help get `kinds: ['production', 'staffing']`. Help is Showflow's booking help; it returns for `handwerk` when Werkbank help content exists (Teil 2). Dashboard, Settings and Platform stay unrestricted.
- Modules contribute nav items and routes. Werkbank contributes "Monteure" (Teil 1) and later its business pages.
- `ROUTE_KINDS`, analogous to `ROUTE_FEATURES`, maps route patterns to allowed kinds. `ProtectedRoute` redirects to the dashboard when the active org's kind is not allowed. Super-admins are not exempt here (unlike the membership gate), because a mismatching kind means a broken page rather than a missing permission. This gate is UX; data protection stays in RLS.
- `DashboardPage` picks its body from a per-kind registry. Werkbank contributes a plain placeholder in Teil 1.
- Settings tabs gain the same `kinds` filter, including the `?tab=` deep link, which falls back to the default tab when the tab is hidden for the kind. For `handwerk`, How it works, Get running, Booking engine, Hire orders, Sources (Airtable), Casts and coverage, and Skills are hidden; Organization, People, Activity, Roles and rights, Email templates, Notifications, Trust and data, and Docs stay.

### R6. Provisioning defaults

- A module may contribute `provisioningDefaults[kind] = { entitlements, settings, skipBookingFlowSeed }` through the edge manifest. Precedence for each entitlement: kind default, then the request body (the New organization dialog sends explicit toggles), then platform defaults. `provision-org` upserts the kind's settings and skips the booking-flow "off" seed when `skipBookingFlowSeed` is true.
- Werkbank defaults for `handwerk`: entitlements `booking_flow = false`, `hire_orders = false`, `language_packages = true`; settings `org_language = 'de'`.
- Creating a `handwerk` org works through Platform, Organizations, New, with the kind picker (R2).

### R7. Technicians page (plugin)

- Route under `ROUTE_KINDS` for `handwerk`, roles admin and producer, nav label "Monteure".
- Lists the org's `artists` rows: name, email, phone, account state (invited, active, no account) using the existing data functions and the `list_pending_invited_artists` RPC.
- "Monteur anlegen" creates an `artists` row, then calls `create-invitation` with `artist_id` and role `artist`. Resend and revoke use the existing invitation mutations.
- Office staff are invited through the existing People pane with the role displayed as "Büro".
- Data access in `src/features/werkbank/data/technicians.ts`, hooks in `src/features/werkbank/hooks/`. All copy through the `werkbank` i18n namespace (EN and DE, informal "Du", no dashes).

### R8. The `werkbank` schema (plugin)

- Migration `*_werkbank_schema.sql`: `create schema werkbank`, `grant usage` to `authenticated` and `service_role`, default privileges for future tables and functions in that schema, and the `org_kinds` row `('handwerk', false, false)`.
- `supabase/config.toml` `[api] schemas` lists `public`, `graphql_public`, `werkbank`.
- Type generation includes `--schema public,werkbank`; the edge mirror of the generated types is regenerated by `npm run sync:mirrors`.
- Werkbank code reaches its tables only through `supabase.schema('werkbank')`.
- Teil 1 creates no tables in the schema; it establishes the pattern and the guard (R9) so Teil 2 only adds tables.

### R9. Isolation guards (core)

- ESLint `no-restricted-imports`:
  - in `src/features/werkbank/**`, `supabase/functions/werkbank-*/**` and `_shared/werkbank/**`: no imports of booking, show, show-date, cast, hire-order or Airtable modules (exact path list in the plan);
  - everywhere else: no imports of `src/features/werkbank/**` or `_shared/werkbank/**`, except from the manifest files (`src/modules/*.ts`, `_shared/modules.ts`).
- `scripts/moduleIsolation.test.ts`: scans git-tracked files and fails on `werkbank` or `handwerk` (case-insensitive) outside the allowed plugin paths. Allowed-path lists live in the test, per module.
- `supabase/tests/werkbank/isolation.test.sql` (pgTAP): no object in schema `public` depends on an object in schema `werkbank` (via `pg_depend` and `pg_rewrite` for views and functions).

## Decisions resolved in spec review

- **D1. Extraction threshold.** About 10 paying businesses, as in ADR-0013 (owner, 2026-10-06).

## Testing

Test-first per CLAUDE.md. Tests import real modules.

- **Vitest:** vocabulary completeness for `handwerk` (existing test, now covering module kinds); `roleLabel` and `roleDescription` per kind, including byte-identical output for `production` and `staffing`; brand resolution order (kind, session hint, host, fallback); `visibleNavItems` with `kinds`; `ROUTE_KINDS` matching; settings-tab filtering; manifest composition (a module kind appears in `ORG_KINDS`, labels and vocabulary); `moduleIsolation.test.ts`.
- **pgTAP:** `provision_org` with `handwerk` creates no starter catalog and with `production` still does; the kind-switch trigger rejects an org admin switching into and out of `handwerk`, allows super-admin and service role, and still allows `production` to `staffing`; `org_kinds` is not writable by `authenticated`; the schema isolation test.
- **Deno:** `provision-org` applies Werkbank provisioning defaults; `exchange-invitation` returns `brand` only on success and is otherwise unchanged; email links use the brand `appUrl` when set and `APP_URL` otherwise.
- **Playwright smoke:** a super-admin creates a `handwerk` org; its admin sees the Werkbank name, the Monteure item and no Showflow items; creating a technician produces a pending invitation. Modelled on the existing org-kind e2e smoke.
- **CI:** no new job in Teil 1. The Mustang validation job arrives with Teil 4.

## Delivery

Separate PRs so the core can ship and be reviewed on its own, and the plugin can be reverted while no pilot data exists:

1. **Core extension points:** R1 (empty manifest), R2, R3 mechanism (`roleArtist`), R4 mechanism (Showflow brand only), R5, R6 mechanism, R9. Production and staffing behaviour unchanged; proven by tests.
2. **Werkbank plugin:** R1 registration, R3 values, R4 Werkbank brand, R6 defaults, R7, R8, CLAUDE.md section (about 15 lines pointing at ADR-0013 and the module boundary).

Changelog: none. Nothing changes for existing customers, and creating `handwerk` orgs is a super-admin action, which the changelog never mentions. Help center impact: none in Teil 1; the Werkbank help content starts in Teil 2. Page minis: "No mini." for the technicians page and the dashboard placeholder in Teil 1, because they are shells; minis arrive with the business pages. System map: no automation change.

## Go-live checklist (when the Werkbank domain exists)

1. Set the Werkbank brand's `appUrl`, `hosts` and `defaultFrom`.
2. Add the domain to the Vercel project.
3. Add the domain to the Supabase Auth redirect URLs (`supabase/config.toml` and the production dashboard).
4. Verify the sender domain at Resend.
5. Production dashboard: "Exposed schemas" includes `werkbank` (required as soon as R8 ships, not only at go-live). Order: apply the `*_werkbank_schema` migration in production first, then add the schema; PostgREST cannot load an exposed schema that does not exist. Removal reverses this (ADR-0013, Removal procedure).
6. Magic-link emails are sent without an org, so they are always Showflow-branded. They need a host-based brand resolution before Werkbank users sign in by magic link on the Werkbank domain.
7. Callers still pass `APP_URL`-based links in `templateData`: `generate-hire-orders` (`download_url`), `platform-manage-user` (`appOrigin`), `cron-health-watcher` and `tier-at-risk-watcher`. Each must use the brand's app URL (`brandAppUrl`) before the Werkbank domain goes live.

## Risks

- **Mirror wiring for module kinds.** The org-kind and brand blocks are sentinel mirrors that must import nothing. Composing module entries outside the blocks needs care in both runtimes. The plan must prove it with the existing mirror check.
- **Forgotten exposed schema.** The production "Exposed schemas" setting is manual. Without it every Werkbank query returns 404. Mitigation: checklist item above, plus a health check on the first Werkbank deploy.
- **Shared release train.** A Showflow regression can reach the pilot. Mitigation: the existing CI gates; Werkbank e2e smoke from Teil 1 on.
- **Kind lock deviates from the 2026-09-14 rule "never locked".** Only for kinds flagged non-switchable; production and staffing keep the old rule.
