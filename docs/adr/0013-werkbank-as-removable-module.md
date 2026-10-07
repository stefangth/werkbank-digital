# ADR-0013: Werkbank Digital is built as a removable module inside Showflow

**Status:** Superseded by [ADR-0014](0014-werkbank-as-separate-fork.md) (2026-10-07)
**Date:** 2026-10-06
**Deciders:** Owner (brainstorming session, 2026-10-06)

**Implementing specs:** [`2026-10-06-werkbank-fundament-design.md`](../superpowers/specs/2026-10-06-werkbank-fundament-design.md) (Teil 1). Later parts get their own specs.

## Context

Werkbank Digital is a back-office SaaS for trade businesses (Handwerksbetriebe), in the
spirit of Tooltime: customers, quotes, orders, invoices, dunning, and a mobile view for
technicians. A concrete pilot business exists. Its customers are mostly property
management companies (Hausverwaltungen), so invoices must be machine-readable
e-invoices (EN 16931, ZUGFeRD) from the first version.

Showflow already contains a proven platform layer that Werkbank needs: Supabase auth,
pooled multi-tenancy with org isolation (ADR-0003), per-org roles (ADR-0004), invite-only
onboarding (ADR-0005), entitlements and capabilities, transactional email with per-org
language, a server-side PDF engine with letterhead, numbering, terms and signatures, the
Platform console, GDPR export and deletion, and a CI that gates every layer. It also has a
workspace-type mechanism (`org_kind`, spec 2026-09-14) that changes vocabulary per org.

Showflow's domain, however, is deeply embedded: on 2026-10-06, 1101 of roughly 1200 files
under `src/` and `supabase/` referenced `artist`, `producer`, `show_date` or `booking`, and
the schema carries 242 migrations. The maintainer is a single person.

## Decision

1. **Werkbank is a module inside the Showflow codebase and its Supabase project**, selected
   per organization through a new org kind `handwerk`, with its own brand (name, logo,
   later its own domain and mail sender).
2. **The module is built to be removable and extractable.** Every change falls into one of
   two categories:
   - **Kind-neutral core extension points.** They contain no Werkbank names and remain
     useful without Werkbank (for example for `staffing`): kind-aware navigation, routes
     and dashboards, a brand registry, per-kind role labels, org kinds as a table with
     behaviour flags, module-supplied provisioning defaults.
   - **The Werkbank plugin.** Everything Werkbank-specific lives in
     `src/features/werkbank/`, `supabase/functions/werkbank-*`,
     `supabase/functions/_shared/werkbank/`, migrations named `*_werkbank_*`, tests under
     `supabase/tests/werkbank/`, and a dedicated Postgres schema `werkbank`. It plugs into
     the core through one line per manifest file (`src/modules/*.ts`,
     `supabase/functions/_shared/modules.ts`).
3. **Isolation is enforced by CI, not by discipline:** ESLint import boundaries in both
   directions, a scan test that fails when `werkbank` or `handwerk` appears outside the
   allowed paths, and a pgTAP test that fails when any object in `public` depends on an
   object in `werkbank`.

## Options Considered

| Option | Summary | Verdict |
|---|---|---|
| A. Separate repo and Supabase project, port the platform layer selectively | Clean brand and data separation | Rejected for the pilot phase: weeks to rebuild auth, orgs, invites, email and PDF, then every platform fix is made twice by one maintainer |
| **B. Module inside Showflow, removable by construction** | One codebase, one CI, one deploy; pilot provisioned in days | **Chosen** |
| C. Fork Showflow including a copy of its backend | Start from everything | Rejected: inherits 1101 domain-coupled files and 242 migrations, combining the costs of A and B |
| B without isolation rules | Hardcode `'handwerk'` where needed | Rejected: removal or extraction would mean a search through the whole codebase and an unsafe schema cleanup |

## Trade-off Analysis

- **Speed versus separation.** B reuses the platform layer at zero porting cost. The price
  is that Werkbank and Showflow share a database, a deploy and a release train. A bad
  Showflow deploy can affect invoicing and vice versa. The CI gates mitigate this; they do
  not remove it.
- **Isolation cost.** Building extension points as registries instead of hardcoding the
  new kind costs an estimated 10 to 20 percent extra in Teil 1 and little afterwards.
- **New pattern.** A second exposed Postgres schema is new to this repo. It needs a
  `[api] schemas` entry in `supabase/config.toml`, type generation with
  `--schema public,graphql_public,werkbank`, client access via
  `supabase.schema('werkbank')`, and a manual "Exposed schemas" setting in the production dashboard that no migration can apply.
- **Brand.** Until Werkbank has its own domain, pre-login pages and email links resolve to
  the Showflow host. Inside the app, Werkbank orgs see the Werkbank brand from Teil 1.

## Consequences

- Org kinds become data (`public.org_kinds`) instead of a check constraint. Adding a kind is
  a row plus a registry entry; the core never names a module's kind.
- The roles `admin`, `producer`, `artist` stay unchanged in the database. Werkbank displays
  them as Admin, Büro (office) and Monteur (technician).
- E-invoicing is feasible on the existing stack. A throwaway spike (2026-10-06) rendered a
  PDF with `@react-pdf/renderer` under Deno, turned it into ZUGFeRD EN 16931 and XRechnung
  with `@e-invoice-eu/core` 3.4.0, and passed the Mustang validator (veraPDF PDF/A-3 plus the
  EN 16931 and XRechnung schematron) with zero findings, without network, subprocess or
  out-of-directory writes. The only failure found was a non-embedded standard font
  (Helvetica); the embedded Geist font passes. Invoice PDFs must therefore embed every font.
  Not yet verified inside the Supabase Edge Runtime itself.

### Removal procedure

The order matters; each step names why.

1. Export every Werkbank org's data and hand it to the business (invoices are subject to
   statutory retention; the obligation is the business's, but it needs its data).
2. Delete the `handwerk` organizations while the schema still exists. This works because
   every table in schema `werkbank` that references `public.organizations` declares
   `on delete cascade` (a rule for Teil 2 and later), so an org's Werkbank rows go with it.
   The orgs must be gone before step 4, which deletes their kind (`organizations.org_kind`
   references `public.org_kinds`).
3. Remove `werkbank` from the exposed API schemas, in the production dashboard (Settings,
   API, "Exposed schemas") and in `supabase/config.toml`, before the drop migration runs.
   PostgREST cannot load an exposed schema that no longer exists, so dropping it first
   breaks the API for every org.
4. Add one new migration named `*_werkbank_*` (for example
   `YYYYMMDDHHMMSS_werkbank_removal.sql`) containing
   `drop schema if exists werkbank cascade;` and
   `delete from public.org_kinds where kind = 'handwerk';`. Keep the existing
   `*_werkbank_*` migration files as history: production has their versions recorded, and
   deleting them breaks `scripts/check-migrations.mjs` and `supabase db push`.
5. Delete the plugin paths except the migrations, the manifest lines, the Werkbank
   boundary rules in `eslint.config.js` and the Werkbank allow-list in
   `scripts/moduleIsolation.test.ts` except its `supabase/migrations/*_werkbank_*.sql`
   entry; regenerate the types without `werkbank`; run `supabase functions delete` for each
   `werkbank-*` function (the deploy workflow never deletes functions).

Storage is not covered by any of these steps: neither the org delete nor
`drop schema werkbank` touches the buckets `werkbank-assets` and `werkbank-documents`, and
their objects hold customer data (logos, quote PDFs, signatures). After the export in step 1,
empty both buckets through the Storage API (dashboard or CLI; direct deletes from
`storage.objects` are blocked) and delete them, and drop the five `Werkbank ...` policies on
`storage.objects` in the removal migration of step 4.

At go-live the mirror image applies: apply the `*_werkbank_schema` migration in
production first, then add `werkbank` to "Exposed schemas".

What remains are the kind-neutral extension points.

Before any pilot data exists, the Werkbank PRs can simply be reverted, because they only
add files and the manifest lines on top of the core PRs.

### Extraction criteria

Move Werkbank into its own repository (`werkbank-digital`) and Supabase project when any of
these holds: it is run by its own company or under its own contracts; it reaches about 10
paying businesses; or it needs platform-layer changes that would harm Showflow. Extraction
moves the same paths that removal deletes, so the isolation rules serve both.

## Action Items

Werkbank V1 is delivered in parts, each with its own spec, plan and implementation:

| Part | Scope | State |
|---|---|---|
| 0 | Throwaway spike: ZUGFeRD from the existing PDF stack | Done 2026-10-06 (see Consequences) |
| 1 | Foundation: org kind `handwerk`, brand, kind-aware surface, provisioning, technicians page, `werkbank` schema, isolation guards | Spec 2026-10-06 |
| 2 | Master data: property managers, properties, contacts, service catalog | Open |
| 3 | Quote to order: documents with line items, numbering, PDF, email, conversion, the property manager's order number, technician assignment | Open |
| 4 | Invoice: from order, GoBD lock, cancellation and credit note, ZUGFeRD, Mustang validation in CI | Open |
| 5 | Open items and dunning | Open |
| 6 | Technician view (mobile): assigned orders, time and material, notes and photos, customer signature | Open |

DATEV export is out of scope for V1.
