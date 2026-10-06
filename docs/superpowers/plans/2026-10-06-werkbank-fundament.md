# Werkbank Teil 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A super-admin can create a `handwerk` org whose people see the Werkbank brand, a Werkbank-only navigation, a dashboard placeholder and a technicians page, while `production` and `staffing` orgs behave exactly as before and Werkbank stays removable.

**Architecture:** PR 1 adds kind-neutral extension points to the core (org kinds as data, composable org-kind and brand registries, kind filters for nav, routes and settings, provisioning defaults, isolation guards), each fed by empty module manifests. PR 2 adds the Werkbank plugin, which fills the manifests with one entry each and adds the `werkbank` Postgres schema.

**Tech Stack:** React 18, Vite, TypeScript, react-i18next, TanStack Query, Supabase (Postgres, pgTAP, Deno edge functions), Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-06-werkbank-fundament-design.md` (with ADR-0013). Read both before starting.

## Global Constraints

- Production and staffing output must stay byte-identical: role labels, role descriptions, vocabulary, nav, settings, emails, provisioning. Existing tests must pass unchanged unless a task says otherwise.
- Test-first. Tests import real modules; never re-implement logic in a test. Frontend data access goes through `src/data/*` style functions taking the client; test with `createFakeSupabase` (`src/test/supabaseFake.ts`). Edge functions export `handle(req, deps)`; test with `makeFakeDeps` (`supabase/functions/_shared/testing.ts`).
- Mirrors: never hand-edit a mirror target. Edit the source, run `npm run sync:mirrors`, verify with `npm run sync:mirrors:check`. Block-mode blocks must not contain imports; put imports above the block in each runtime file.
- `any` is banned; lint runs with `--max-warnings 0`.
- Migrations: `supabase/migrations/YYYYMMDDHHMMSS_snake_case.sql`. After a schema change regenerate types: `supabase gen types typescript --local --schema public,werkbank > src/integrations/supabase/types.ts && npm run sync:mirrors` (use `--schema public` until Task 15 creates `werkbank`).
- Copy: all user-facing strings through `t()`; EN and DE key-for-key; German informal lowercase "du"; no em or en dashes, no exclamation marks, no emoji.
- Commits: imperative, lowercase, at most 72 characters, ending with the attribution trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Before each PR: `npm run verify:fast` green; before PR 2 merges: `npm run verify:full` green.
- New kind identifier `handwerk`, brand key `werkbank`, i18n namespace `werkbank`, technicians route `/technicians`, brand hint storage key `showflow.brandHint.v1`.

## Review Focus

1. A `handwerk` org admin opens Settings, Organization: the workspace-type picker shows "Handwerksbetrieb" disabled, not an empty or switchable select (Task 4, Task 11).
2. A bookmarked Showflow URL (`/dates`, `/contracts/123`, `/settings?tab=booking`) opened inside a `handwerk` org lands on the dashboard or the default settings tab instead of a broken page (Task 8, Task 9).
3. A user in both a production and a `handwerk` org switches orgs: brand, nav and role labels follow without a reload (Task 5, Task 13).
4. An invitation email to a technician says "Monteur" in German, while production and staffing invitation emails are unchanged (Task 3, Task 11).
5. `exchange-invitation` still returns 200 with `action_url` when the brand lookup fails (Task 6).

---

## PR 1: Core extension points

### Task 1: Org kinds as data (database)

**Files:**
- Create: `supabase/migrations/20261006120000_org_kinds_table.sql`
- Create: `supabase/tests/rpc/org_kinds.test.sql`
- Modify: `supabase/tests/rpc/set_org_kind.test.sql` (invalid-kind assertion)
- Modify: `src/integrations/supabase/types.ts`, `supabase/functions/_shared/database.types.ts` (regenerated)

**Interfaces:**
- Produces: table `public.org_kinds(kind text pk, seeds_starter_catalog boolean not null, switchable_by_org_admin boolean not null)`; `provision_org` and `set_org_kind` validate against it; trigger `organizations_org_kind_guard`.

- [ ] **Step 1: Write the failing pgTAP test** `org_kinds.test.sql` (pattern of `db/platform_console.sql`: insert users with `session_replication_role = replica`, `pg_temp.act_as`, `SET LOCAL ROLE authenticated`). Seed a test-only row `insert into public.org_kinds values ('locked_test', false, false)` as postgres. Assertions:
  - `results_eq` rows of `org_kinds` for `production` and `staffing` are `(true, true)`.
  - Super-admin `provision_org('A','a-prod','a@x.test','admin','production')` creates starter catalog rows (count of `casts` for the org `> 0`).
  - Super-admin `provision_org(...,'locked_test')` creates zero `casts` for the org.
  - `provision_org(...,'circus')` throws `22023`.
  - Org admin (`has_org_role` admin, not super-admin) `set_org_kind(org,'locked_test')` on a production org throws `42501`; on a `locked_test` org setting `'production'` throws `42501`.
  - Org admin `set_org_kind(org,'staffing')` on a production org lives.
  - Super-admin `set_org_kind` into and out of `locked_test` lives.
  - As `authenticated`, `insert into public.org_kinds` throws `42501`.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL (`relation "public.org_kinds" does not exist`).
- [ ] **Step 3: Write the migration.** Create table, enable RLS, policy `org_kinds_read` for `authenticated` select `using (true)`, no write policies; insert `('production', true, true), ('staffing', true, true)`; `alter table organizations drop constraint organizations_org_kind_check, add constraint organizations_org_kind_fkey foreign key (org_kind) references public.org_kinds(kind)`; recreate `provision_org` with the same signature and grants as `20260914120000_org_kind.sql:45-82`, replacing the literal kind check with `if not exists (select 1 from org_kinds where kind = p_org_kind) then raise ... '22023'` and calling `seed_org_starter_catalog` only when that row's `seeds_starter_catalog`; recreate `set_org_kind` validating against the table; add `BEFORE UPDATE OF org_kind ON organizations` trigger function `public.guard_org_kind_switch()` (security definer, `search_path = public`) that raises `42501` when `new.org_kind is distinct from old.org_kind`, either kind has `switchable_by_org_admin = false`, `auth.uid() is not null`, and `not is_super_admin(auth.uid())`.
- [ ] **Step 4: Update** `set_org_kind.test.sql`: the direct `UPDATE ... SET org_kind='circus'` now throws `23503` (foreign key) instead of `23514`.
- [ ] **Step 5: Run** `npm run test:db`. Expected: PASS.
- [ ] **Step 6: Regenerate types** (`--schema public`) and run `npm run sync:mirrors:check && npx tsc -p tsconfig.app.json --noEmit`. Expected: clean.
- [ ] **Step 7: Commit** `add org_kinds table with catalog and switch flags`.

### Task 2: Composable org-kind registry and data manifests

**Files:**
- Create: `src/modules/registry.ts`, `supabase/functions/_shared/modules.ts`
- Modify: `src/lib/orgKind.ts`, `supabase/functions/_shared/orgKind.ts` (mirror), `src/lib/orgKind.test.ts`, `supabase/functions/_shared/orgKind.test.ts`

**Interfaces:**
- Produces (in the mirrored block):
  ```ts
  export type CoreOrgKind = "production" | "staffing";
  export type OrgKind = CoreOrgKind | ModuleOrgKind;          // ModuleOrgKind imported above the block
  export interface OrgKindDef<K extends string = string> {
    kind: K; brand: string;
    labels: Record<OrgKindLang, { title: string; desc: string }>;
    vocabulary: Record<OrgKindLang, Vocabulary>;
    switchableByOrgAdmin: boolean; seedsStarterCatalog: boolean; roleLabelsFollowUiLanguage: boolean;
  }
  export function composeOrgKinds(core: readonly OrgKindDef[], modules: readonly OrgKindDef[]): Record<string, OrgKindDef>;
  export const ORG_KIND_DEFS: Record<OrgKind, OrgKindDef>;
  export function isSwitchableByOrgAdmin(kind: OrgKind): boolean;
  export function roleLabelsFollowUiLanguage(kind: OrgKind): boolean;
  ```
  `ORG_KINDS`, `ORG_KIND_LABELS`, `VOCABULARY`, `isOrgKind`, `coerceOrgKind`, `DEFAULT_ORG_KIND`, `interpolateVocabulary` keep their names and shapes, now derived from `ORG_KIND_DEFS` (core order first: production, staffing).
- Produces: `src/modules/registry.ts` exports `MODULE_ORG_KINDS = [] as const satisfies readonly OrgKindDef[]`, `type ModuleOrgKind = (typeof MODULE_ORG_KINDS)[number]["kind"]`, `MODULE_BRANDS: readonly BrandDef[] = []` (type added in Task 5; until then omit). Edge twin exports the same names plus `MODULE_PROVISIONING` (Task 10).
- `VocabKey` gains `"roleArtist"`; value `"Artist"` for production and staffing in both languages. Core defs: `brand: "showflow"`, `switchableByOrgAdmin: true`, `seedsStarterCatalog: true`, `roleLabelsFollowUiLanguage: false`.

- [ ] **Step 1: Write failing tests** in `src/lib/orgKind.test.ts`:
  - `composeOrgKinds` with a fake module def `{ kind: "test_kind", ... }` returns keys `["production","staffing","test_kind"]` in that order.
  - `composeOrgKinds` throws `Duplicate org kind: production` when a module redefines a core kind.
  - `ORG_KINDS` equals `["production","staffing"]` (manifest empty).
  - `VOCABULARY.production.en.roleArtist === "Artist"` and same for staffing, both languages.
  - `isSwitchableByOrgAdmin("staffing") === true`; `roleLabelsFollowUiLanguage("production") === false`.
  - Deno `_shared/orgKind.test.ts`: `ORG_KINDS.length === 2` stays; add `ORG_KIND_DEFS.production.brand === "showflow"`.
- [ ] **Step 2: Run** `npx vitest run src/lib/orgKind.test.ts`. Expected: FAIL (`composeOrgKinds` not exported).
- [ ] **Step 3: Implement.** In `src/lib/orgKind.ts` add above the block `import { MODULE_ORG_KINDS, type ModuleOrgKind } from "@/modules/registry";`; in `_shared/orgKind.ts` the same from `"./modules.ts"`. `src/modules/registry.ts` imports `type OrgKindDef` from `@/lib/orgKind` (type-only, no runtime cycle). Rebuild the block around `CORE_ORG_KIND_DEFS` (the current labels and vocabulary tables moved into two `OrgKindDef` objects) and `ORG_KIND_DEFS = composeOrgKinds(CORE_ORG_KIND_DEFS, MODULE_ORG_KINDS)`.
- [ ] **Step 4: Run** `npm run sync:mirrors && npm run sync:mirrors:check && npx vitest run src/lib src/i18n src/config && deno test --allow-all --node-modules-dir=none supabase/functions/_shared/orgKind.test.ts && npx tsc -p tsconfig.app.json --noEmit`. Expected: PASS, including the untouched vocabulary, kindVariants and email/PDF copy byte-identity tests.
- [ ] **Step 5: Commit** `make the org kind registry composable from modules`.

### Task 3: Role labels per kind and language

**Files:**
- Modify: `src/config/app.config.ts` (ROLE LABELS MIRROR block), `supabase/functions/_shared/roles.ts` (mirror + helper below the block)
- Modify callers: `src/components/admin/people/{InviteBar,RemovedPersonRow,BulkInviteDialog,InviteRow,PersonRow}.tsx`, `src/pages/AcceptInvitePage.tsx`
- Modify: `supabase/functions/{create-invitation,resend-invitation,provision-org}/index.ts`
- Test: `src/config/roleLabel.test.ts`, `src/config/appConfig.roles.test.ts`, `supabase/functions/_shared/roles.test.ts` (create)

**Interfaces:**
- Produces: `roleLabel(role: string, kind: OrgKind = DEFAULT_ORG_KIND, lang: OrgKindLang = "en"): string` and `roleDescription(role, kind, lang)`. The table language is `roleLabelsFollowUiLanguage(kind) ? lang : "en"`. `producer` reads `roleProducer`, `artist` reads `roleArtist`, `admin` stays `ROLE_LABELS.admin`.
- Produces (edge, below the block in `_shared/roles.ts`): `inviteRoleLabel(role: string, kind: OrgKind, locale: "en" | "de"): string` returning `roleLabel(role, kind, locale)` when `roleLabelsFollowUiLanguage(kind)`, else `roleLabel(role)` (today's behaviour for production and staffing emails).

- [ ] **Step 1: Write failing tests:**
  - `roleLabel("producer","staffing","de") === "Booking team"` (staffing does not follow UI language).
  - `roleLabel("artist","production","de") === "Artist"`; `roleLabel("admin","staffing","de") === "Admin"`.
  - `roleDescription(r,"production","de") === ROLE_DESCRIPTIONS[r]` for all three roles.
  - Deno `roles.test.ts`: `inviteRoleLabel("producer","staffing","de") === "Production Team"` (unchanged email behaviour).
- [ ] **Step 2: Run** `npx vitest run src/config` and `deno test --allow-all --node-modules-dir=none supabase/functions/_shared/roles.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in the block; `npm run sync:mirrors`. Pass `useLanguage().lang` as third argument at the listed client callers (they already pass a kind). In the three edge functions replace `roleLabel(role)` with `inviteRoleLabel(role, await resolveOrgKind(deps.admin, orgId), await resolveOrgLocale(deps.admin, orgId))`.
- [ ] **Step 4: Run** the tests from Step 2 plus `npm run test:functions`. Expected: PASS; existing invitation tests unchanged.
- [ ] **Step 5: Commit** `resolve role labels per kind and ui language`.

### Task 4: Workspace-type pickers respect locked kinds

**Files:**
- Modify: `src/components/settings/OrgKindSelect.tsx`, `src/components/getRunning/v3/steps/WorkspaceStep.tsx`, `src/components/platform/{NewOrgDialog,EditOrgDialog}.tsx`
- Test: `src/components/settings/OrgKindSelect.test.tsx`, WorkspaceStep test (co-located)

**Interfaces:**
- Produces: `OrgKindSelect` prop `includeLocked?: boolean` (default `false`). Options are `ORG_KINDS` filtered by `isSwitchableByOrgAdmin` unless `includeLocked`. When `value` is not switchable and `includeLocked` is false, render the select disabled with only the current value.

- [ ] **Step 1: Write failing tests** with `vi.mock("@/lib/orgKind", async (importOriginal) => ({ ...(await importOriginal()), isSwitchableByOrgAdmin: (k: string) => k !== "staffing" }))` so `"staffing"` reports locked (ESM exports cannot be spied on):
  - without `includeLocked`, options are `["Live production"]`;
  - with `includeLocked`, both options;
  - `value="staffing"` without `includeLocked` renders a disabled combobox showing "Staffing agency".
  - WorkspaceStep renders radio cards only for switchable kinds.
- [ ] **Step 2: Run** `npx vitest run src/components/settings/OrgKindSelect.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**; pass `includeLocked` in `NewOrgDialog.tsx:103` and `EditOrgDialog.tsx:124`. Widen the zod enum in `NewOrgDialog.tsx:28` to the composed `ORG_KINDS` (already the source).
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `hide locked workspace types from org admins`.

### Task 5: Brand registry and brand surfaces

**Files:**
- Create: `src/lib/brand.ts`, `supabase/functions/_shared/brand.ts` (block target, imports above block), `src/hooks/useBrand.ts`, `src/components/brand/BrandMark.tsx`, `src/features/brand/BrandDocument.tsx`
- Modify: `scripts/mirrors.manifest.json` (block entry, sentinels `// >>> BRAND REGISTRY MIRROR (keep byte-identical with the twin file) >>>` / `// <<< BRAND REGISTRY MIRROR <<<`), `src/modules/registry.ts`, `supabase/functions/_shared/modules.ts` (`MODULE_BRANDS`)
- Modify: `AppLayout.tsx` (lines 143-144, 390-391), `LoginPage.tsx` (146-148), `ResetPasswordPage.tsx` (81, 86), `AcceptInvitePage.tsx` (435, 471, 521, 603), `AuthCallbackPage.tsx` (56), `NoOrgScreen.tsx` (16), `FeatureDisabledScreen.tsx` (28), `SuspendedOrgScreen.tsx` (45), `src/App.tsx` (mount `BrandDocument`)
- Test: `src/lib/brand.test.ts`, `src/hooks/useBrand.test.tsx`, `src/components/brand/BrandMark.test.tsx`

**Interfaces:**
- Produces (block):
  ```ts
  export interface BrandDef { key: string; name: string; markSvgPath: string | null; emailMarkPath: string;
    faviconPath: string; appUrl: string | null; hosts: readonly string[]; defaultFrom: string | null; }
  export const DEFAULT_BRAND_KEY = "showflow";
  export function composeBrands(core: readonly BrandDef[], modules: readonly BrandDef[]): Record<string, BrandDef>;
  export const BRANDS: Record<string, BrandDef>;
  export function brandForKind(kind: OrgKind): BrandDef;              // ORG_KIND_DEFS[kind].brand, fallback showflow
  export function resolveBrand(input: { orgKind: OrgKind | null; hint: string | null; hostname: string }): BrandDef;
  export function brandAppUrl(brand: BrandDef, fallback: string): string;   // brand.appUrl ?? fallback
  ```
  Showflow brand: `{ key: "showflow", name: "ShowFlow", markSvgPath: null, emailMarkPath: "/email/showflow-mark.png", faviconPath: "/favicon.svg", appUrl: null, hosts: [], defaultFrom: null }`. `markSvgPath: null` means "render the built-in `StageMark`".
- Produces: `useBrand(): BrandDef` (signed in with `currentOrg` → its kind; else `sessionStorage["showflow.brandHint.v1"]` read in try/catch; else `location.hostname`). `BrandMark({ variant, size }: { variant: "mark" | "tile"; size: number })` renders `StageMark` for `markSvgPath === null`, otherwise `<img src={markSvgPath} alt="" width={size} height={size}>`. `BrandName()` renders `BrandWordmark` for showflow, otherwise the brand name. `BrandDocument()` sets `document.title` to the brand name and the `link[rel=icon]` href to `faviconPath`, only when the brand is not showflow (leaves `index.html` defaults untouched for showflow).

- [ ] **Step 1: Write failing tests:**
  - `resolveBrand` order: kind wins over hint and host; hint wins over host; host match wins over default; unknown hint falls through; everything empty gives showflow. Use `composeBrands` with a fake module brand `{ key: "test_brand", hosts: ["test.example"] }` and pass the composed map through a test-only overload `resolveBrandIn(brands, kindBrandKey, input)` exported for tests and used by `resolveBrand`.
  - `composeBrands` throws `Duplicate brand: showflow`.
  - `useBrand` re-renders with a new brand when `currentOrg` changes (Review Focus 3): render with `authOverrides.currentOrg` production, rerender with a fake kind mapped to `test_brand`, expect the name to change.
  - `BrandMark` for showflow renders the same markup as `StageMark` (existing BrandWordmark and page tests stay green).
- [ ] **Step 2: Run** `npx vitest run src/lib/brand.test.ts src/hooks/useBrand.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**; replace the listed `StageMark`/`APP_META.NAME`/`BrandWordmark` uses with `BrandMark`/`BrandName`/`useBrand().name`; mount `BrandDocument` once inside the router in `App.tsx`. `npm run sync:mirrors`.
- [ ] **Step 4: Run** `npx vitest run` (full suite). Expected: PASS with no snapshot or text changes for showflow.
- [ ] **Step 5: Commit** `add brand registry and brand-aware shell surfaces`.

### Task 6: Invitation brand hint

**Files:**
- Modify: `supabase/functions/exchange-invitation/index.ts`, `src/data/invitations.ts` (`exchangeInvitation`), `src/pages/AcceptInvitePage.tsx` (`handleExchange`, lines 413-427)
- Test: `supabase/functions/exchange-invitation/index.test.ts`, `src/data/invitations.test.ts`, `src/pages/AcceptInvitePage.test.tsx`

**Interfaces:**
- Produces: success response `{ action_url: string, brand?: string }`. After a successful mint, `deps.admin.from("org_invitations").select("org_id").eq("token", token).maybeSingle()`, then `resolveOrgKind` and `brandForKind(kind).key`. Any failure in this lookup omits `brand` and still returns 200.
- Produces: `exchangeInvitation(...): Promise<{ actionUrl: string; brand: string | null }>`.

- [ ] **Step 1: Write failing tests:**
  - Deno: success with an `org_invitations` row whose org has `org_kind: "production"` returns `{ action_url, brand: "showflow" }`.
  - Deno (Review Focus 5): `org_invitations` select returns `{ data: null, error: { message: "boom" } }`: status 200, body `{ action_url }` exactly.
  - Deno: the 410 and 429 bodies are unchanged (existing tests).
  - Vitest: `exchangeInvitation` returns `brand: "showflow"` when present and `null` when absent.
  - AcceptInvitePage: after a successful exchange with `brand: "showflow"`, `sessionStorage.getItem("showflow.brandHint.v1") === "showflow"` before `location.assign`.
- [ ] **Step 2: Run** `deno test --allow-all --node-modules-dir=none supabase/functions/exchange-invitation/` and `npx vitest run src/data/invitations.test.ts src/pages/AcceptInvitePage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2 commands. Expected: PASS.
- [ ] **Step 5: Commit** `return the inviting org's brand from exchange-invitation`.

### Task 7: Brand in emails

**Files:**
- Modify: `supabase/functions/_shared/transactional-email-templates/_shell/EmailShell.tsx` (lines 115-127), `.../registry.ts` (lines 84-88, 202-206), `supabase/functions/send-transactional-email/index.ts` (lines 257-260, 277-287)
- Modify: every template that builds a link from `APP_URL` and can reach a non-production kind in Teil 1: find with `grep -ln "APP_URL" supabase/functions/_shared/transactional-email-templates/*.tsx`, and convert at least `org-invitation.tsx` and the magic-link and password-reset templates
- Test: `supabase/functions/send-transactional-email/` tests, `_shell/EmailShell` test (create if absent)

**Interfaces:**
- Consumes: `brandForKind`, `brandAppUrl` (Task 5); `kind` already flows into `resolveTemplatePresentation`.
- Produces: `resolveTemplatePresentation` options gain `brand?: BrandDef` (default `brandForKind(options.kind ?? "production")`); `EmailShell` props gain `brand: BrandDef` and render `${brandAppUrl(brand, APP_URL)}${brand.emailMarkPath}` and `brand.name`. Templates receive `appBaseUrl: string` (= `brandAppUrl(brand, APP_URL)`) instead of reading `APP_URL` at module load.
- Sender rule in `send-transactional-email`: when `brand.defaultFrom` is non-null, read the org's own `app_settings` row for `resend_from_address` (`org_id = orgId`); if absent use `brand.defaultFrom`; otherwise the existing `resolveOrgSetting` path.

- [ ] **Step 1: Write failing tests:**
  - Rendering every registered template for kind `production` produces HTML identical to the pre-change render (capture the baseline in the test from a fixed fixture before changing code; commit the baseline file under the test directory).
  - `EmailShell` with a fake brand `{ name: "Test Brand", emailMarkPath: "/t.png", appUrl: "https://t.example" }` renders `https://t.example/t.png` and "Test Brand".
  - Sender: fake brand with `defaultFrom: "Test <a@t.example>"` and no org row → `from` is that; with an org row → the org value.
- [ ] **Step 2: Run** `npm run test:functions`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test:functions && deno check --node-modules-dir=none supabase/functions/*/index.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `render email brand and links from the org's brand`.

### Task 8: Kind-aware navigation, routes and dashboard

**Files:**
- Create: `src/modules/ui.ts`
- Modify: `src/components/layout/navItems.ts`, `src/components/layout/AppLayout.tsx` (line 136), `src/config/app.config.ts` (`ROUTE_KINDS`, `requiredKindsForPath`), `src/features/auth/ProtectedRoute.tsx`, `src/App.tsx`, `src/pages/DashboardPage.tsx`
- Test: `src/components/layout/navItems.test.ts`, `src/config/app.config.test.ts`, `src/features/auth/ProtectedRoute.test.tsx`, `src/pages/DashboardPage.test.tsx`

**Interfaces:**
- Produces: `NavItem.kinds?: OrgKind[]`; `labelKey` widened to `NavLabelKey | \`${string}:${string}\``; `visibleNavItems` ctx gains `orgKind: OrgKind` and hides items whose `kinds` exclude it (before role filtering; never `locked`). `NAV_ITEMS` entries Get running, Dates, Hire orders, Availability, Chats, Productions, Artists, Help get `kinds: ["production","staffing"]`.
- Produces: `ROUTE_KINDS: Record<string, readonly OrgKind[]>` covering `ROUTES.GET_RUNNING, BOOKINGS, HIRE_ORDERS, HIRE_ORDER_DETAIL, HIRE_ORDER_EDIT, HIRE_ORDER_TEMPLATE, AVAILABILITY, CHATS` (and any `/chats/:id` route), `PRODUCTIONS, ARTISTS, HELP` → `["production","staffing"]`, merged with module routes; `requiredKindsForPath(pathname: string): readonly OrgKind[] | undefined` using the same matching as `requiredFeatureForPath`.
- Produces: `src/modules/ui.ts`:
  ```ts
  export interface ModuleRoute { path: string; kinds: readonly OrgKind[]; requiredRoles: AppRole[]; Page: React.ComponentType }
  export interface ModuleUi { navItems: NavItem[]; routes: ModuleRoute[]; dashboards: Partial<Record<OrgKind, React.ComponentType>> }
  export const MODULE_UIS: readonly ModuleUi[] = [];
  ```
  `NAV_ITEMS` appends `MODULE_UIS.flatMap(m => m.navItems)` before Help; `App.tsx` renders each module route as `<ProtectedRoute requiredRoles={r.requiredRoles}><AppLayout><r.Page /></AppLayout></ProtectedRoute>`; `DashboardPage` renders the module dashboard for the active kind when one exists, else today's logic.
- `ProtectedRoute`: after the suspended-org check and before the feature gate, `const kinds = requiredKindsForPath(location.pathname); if (kinds && !kinds.includes(orgKind)) return <Navigate to={ROUTES.DASHBOARD} replace />` (super-admins not exempt).

- [ ] **Step 1: Write failing tests:**
  - navItems: with `orgKind: "production"` the label list equals today's; with a fake kind (`"test_kind" as OrgKind`) only Dashboard, Settings (role-permitting) and Platform (super-admin) remain; a kind-hidden item is absent, not `locked`.
  - `requiredKindsForPath("/contracts/abc")` equals `["production","staffing"]`; `requiredKindsForPath("/today")` is undefined.
  - ProtectedRoute (Review Focus 2): active org with `org_kind: "test_kind"` at `/dates` redirects to `/today`; a super-admin is redirected too; production at `/dates` renders children.
  - DashboardPage: with `MODULE_UIS` mocked (`vi.mock("@/modules/ui")`) to contribute a dashboard for `test_kind`, it renders that component.
- [ ] **Step 2: Run** `npx vitest run src/components/layout src/config src/features/auth src/pages/DashboardPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2 command and `npx tsc -p tsconfig.app.json --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `filter navigation, routes and dashboard by org kind`.

### Task 9: Kind-aware settings tabs

**Files:**
- Modify: `src/lib/settingsTabs.ts`, `src/pages/SettingsPage.tsx` (lines 283-313, 371)
- Test: `src/lib/settingsTabs.test.ts`, `src/pages/SettingsPage.test.tsx`

**Interfaces:**
- Produces: `SETTINGS_TAB_KINDS: Partial<Record<SettingsTabParam, readonly OrgKind[]>>` with `how-it-works, get-running, casts-coverage, skills, airtable, booking, hire-orders` → `["production","staffing"]`; `isSettingsTabAllowedForKind(tab: string, kind: OrgKind): boolean`; `resolveInitialTab(param, isAdmin, isSuperAdmin = false, isProducer = false, kind: OrgKind = DEFAULT_ORG_KIND)` falls back to the default tab when the tab is not allowed for the kind (and the default itself is chosen among allowed tabs).
- `SettingsPage` items: `show` additionally requires `isSettingsTabAllowedForKind(value, orgKind)`.

- [ ] **Step 1: Write failing tests:** `resolveInitialTab("booking", true, false, false, "test_kind")` returns a tab allowed for `test_kind` (`"organization"`); production returns `"booking"`; the production tab list in SettingsPage is unchanged; with `test_kind` the Booking engine, Sources and Skills items are absent.
- [ ] **Step 2: Run** `npx vitest run src/lib/settingsTabs.test.ts src/pages/SettingsPage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2 command. Expected: PASS.
- [ ] **Step 5: Commit** `hide showflow settings tabs for other org kinds`.

### Task 10: Module i18n namespaces and provisioning defaults

**Files:**
- Create: `src/modules/i18n.ts`
- Modify: `src/i18n/index.ts` (resources, `ns`), `src/i18n/react-i18next.d.ts`, `src/i18n/keyParity.test.ts` (namespace list)
- Modify: `supabase/functions/_shared/modules.ts` (`MODULE_PROVISIONING`), `supabase/functions/provision-org/index.ts` (lines 58-101)
- Test: `src/i18n/keyParity.test.ts`, `supabase/functions/provision-org/index.di.test.ts`

**Interfaces:**
- Produces: `src/modules/i18n.ts` exports `MODULE_I18N = {} as const satisfies Record<string, { en: Record<string, unknown>; de: Record<string, unknown> }>`. `resources.en`/`.de` spread the module namespaces; `ns` appends `Object.keys(MODULE_I18N)`; the `.d.ts` adds `& { [N in keyof typeof MODULE_I18N]: (typeof MODULE_I18N)[N]["en"] }`; keyParity iterates its list plus `Object.keys(MODULE_I18N)`.
- Produces (edge): `export interface ProvisioningDefaults { entitlements: Partial<Record<FeatureKey, boolean>>; settings: Record<string, Json>; skipBookingFlowSeed: boolean }`, `MODULE_PROVISIONING: Partial<Record<OrgKind, ProvisioningDefaults>> = {}`.
- Produces in `provision-org/index.ts`: exported pure `mergeEntitlements(platform: Record<FeatureKey, boolean>, requested: Record<string, boolean> | null, kindDefaults: Partial<Record<FeatureKey, boolean>> | undefined): Record<FeatureKey, boolean>` (precedence kind, request, platform); `handle` uses it, upserts `kindDefaults.settings` into `app_settings` (`onConflict: "org_id,key"`) and skips the booking-flow seed when `skipBookingFlowSeed`. `handle` reads defaults through an injectable `deps`-free parameter: `export async function handle(req, deps, provisioning = MODULE_PROVISIONING)`.

- [ ] **Step 1: Write failing tests:**
  - `mergeEntitlements({booking_flow:true,hire_orders:false,language_packages:false}, {booking_flow:true}, {booking_flow:false,language_packages:true})` equals `{booking_flow:false,hire_orders:false,language_packages:true}`.
  - `handle(req with org_kind "staffing", deps, { staffing: { entitlements: {}, settings: { org_language: "de" }, skipBookingFlowSeed: true } })` upserts `org_language` and makes no `booking_flow` upsert.
  - Without provisioning entry, recorded calls equal today's (existing tests unchanged).
- [ ] **Step 2: Run** `deno test --allow-all --node-modules-dir=none supabase/functions/provision-org/` and `npx vitest run src/i18n`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2 commands and `npx tsc -p tsconfig.app.json --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `add module i18n namespaces and provisioning defaults`.

### Task 11 (closes PR 1): Isolation guards

**Files:**
- Modify: `eslint.config.js`
- Create: `scripts/moduleIsolation.test.ts`

**Interfaces:**
- ESLint: one config object `files: ["src/features/werkbank/**/*.{ts,tsx}", "supabase/functions/werkbank-*/**/*.{ts,tsx}", "supabase/functions/_shared/werkbank/**/*.{ts,tsx}"]` with `no-restricted-imports` patterns for `**/data/{bookings,shows,showDates,showAssignments,casts,hireOrders,airtable*}*`, `**/hooks/use{Bookings,Shows,ShowDates,HireOrders,Airtable}*`, `**/components/{bookings,shows,casts,hireOrders,availability}/**`, `**/lib/hireOrders/**`, `**/_shared/{bookingFlow,hireOrders,airtable*,eligibility}*`. A second object for all other `src/**` and `supabase/functions/**` files forbids `**/features/werkbank/**` and `**/_shared/werkbank/**`, with `ignores` for `src/modules/*.ts` and `supabase/functions/_shared/modules.ts`. Merge with the existing `uiConventions` `no-restricted-imports` rule (ESLint keeps only the last object's options for a rule per file, so the werkbank patterns must be appended to the same rule options for `src/**`).
- `moduleIsolation.test.ts`: lists tracked files with `git ls-files -z` (pattern from `scripts/scan-secrets.mjs:147-157`), reads each text file, and fails listing every file containing `/werkbank|handwerk/i` that matches none of `ALLOWED.werkbank`:
  ```
  src/features/werkbank/**, supabase/functions/werkbank-*/**, supabase/functions/_shared/werkbank/**,
  supabase/migrations/*_werkbank_*.sql, supabase/tests/werkbank/**, public/werkbank/**, e2e/werkbank-*.spec.ts,
  src/modules/*.ts, supabase/functions/_shared/modules.ts, docs/**, CLAUDE.md, scripts/mirrors.manifest.json,
  supabase/config.toml, src/integrations/supabase/types.ts, supabase/functions/_shared/database.types.ts,
  eslint.config.js, scripts/moduleIsolation.test.ts
  ```

- [ ] **Step 1: Write the test** with an extra case that runs the matcher on a synthetic list `["src/pages/X.tsx" containing "handwerk"]` and expects one violation (export the matcher `findViolations(files: {path: string; text: string}[]): string[]`).
- [ ] **Step 2: Run** `npx vitest run scripts/moduleIsolation.test.ts`. Expected: synthetic case FAIL until implemented; then repo case PASS (no plugin yet).
- [ ] **Step 3: Implement** test helper and ESLint objects. Prove the ESLint rule: temporarily add `import "@/features/werkbank/x"` to `src/pages/DashboardPage.tsx`, run `npx eslint src/pages/DashboardPage.tsx`, expect `no-restricted-imports`, revert.
- [ ] **Step 4: Run** `npm run verify:fast`. Expected: all layers PASS.
- [ ] **Step 5: Commit** `add module isolation guards`. Open PR 1 (core extension points; state "No help center impact", "No mini", no changelog).

---

## PR 2: Werkbank plugin

### Task 12: Werkbank org kind, brand data and provisioning

**Files:**
- Create: `src/features/werkbank/registry.ts` (zero imports), `supabase/migrations/20261006130000_werkbank_org_kind.sql`, `supabase/tests/werkbank/org_kind.test.sql`, `src/features/werkbank/registry.test.ts`
- Modify: `scripts/mirrors.manifest.json` (file mode: `src/features/werkbank/registry.ts` → `supabase/functions/_shared/werkbank/registry.ts`), `src/modules/registry.ts`, `supabase/functions/_shared/modules.ts`

**Interfaces:**
- Produces: `WERKBANK_ORG_KIND` (`kind: "handwerk"`, `brand: "werkbank"`, `switchableByOrgAdmin: false`, `seedsStarterCatalog: false`, `roleLabelsFollowUiLanguage: true`), labels and the full vocabulary from spec R3 (four forms per noun; `roleProducer` DE "Büro" EN "Office"; `roleArtist` DE "Monteur" EN "Technician"; `kind` "handwerk"); `WERKBANK_BRAND` `{ key: "werkbank", name: "Werkbank Digital", markSvgPath: "/werkbank/mark.svg", emailMarkPath: "/werkbank/email-mark.png", faviconPath: "/werkbank/favicon.svg", appUrl: null, hosts: [], defaultFrom: null }`; `WERKBANK_PROVISIONING = { handwerk: { entitlements: { booking_flow: false, hire_orders: false, language_packages: true }, settings: { org_language: "de" }, skipBookingFlowSeed: true } }`. Manifests register each with one entry.
- Migration: `insert into public.org_kinds values ('handwerk', false, false);`

- [ ] **Step 1: Write failing tests:**
  - Vitest: `ORG_KINDS` includes `"handwerk"`; `roleLabel("artist","handwerk","de") === "Monteur"`, `roleLabel("producer","handwerk","en") === "Office"`, `roleLabel("admin","handwerk","de") === "Admin"`; `brandForKind("handwerk").key === "werkbank"`; `isSwitchableByOrgAdmin("handwerk") === false`; existing vocabulary completeness test covers `handwerk`.
  - pgTAP: org_kinds row `('handwerk', false, false)`; super-admin `provision_org(...,'handwerk')` creates no casts; org admin `set_org_kind(handwerk_org,'production')` throws `42501`.
  - Deno: `handle` for `org_kind: "handwerk"` with a body sending `entitlements: { booking_flow: true }` inserts `booking_flow: false`, `language_packages: true`, upserts `org_language: "de"`, no booking-flow seed; `inviteRoleLabel("artist","handwerk","de") === "Monteur"` and the invitation email payload role label is "Admin" for the first admin (Review Focus 4).
- [ ] **Step 2: Run** `npx vitest run src/features/werkbank src/lib src/config`, `npm run test:db`, `npm run test:functions`. Expected: FAIL.
- [ ] **Step 3: Implement**; `npm run sync:mirrors`; regenerate types.
- [ ] **Step 4: Run** Step 2 commands and `npx vitest run scripts/moduleIsolation.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `register the handwerk org kind and werkbank brand`.

### Task 13: Werkbank shell: i18n, nav, dashboard, assets

**Files:**
- Create: `src/features/werkbank/i18n/en.json`, `src/features/werkbank/i18n/de.json`, `src/features/werkbank/ui.ts`, `src/features/werkbank/components/WerkbankDashboard.tsx` (+ test), `public/werkbank/mark.svg`, `public/werkbank/favicon.svg`, `public/werkbank/email-mark.png`
- Modify: `src/modules/i18n.ts`, `src/modules/ui.ts`

**Interfaces:**
- Produces: `werkbankUi: ModuleUi` with one nav item `{ to: "/technicians", icon: HardHat, label: "Technicians", labelKey: "werkbank:nav.technicians", section: "workspace", roles: ["admin","producer"], kinds: ["handwerk"] }`, the route from Task 14, and `dashboards: { handwerk: WerkbankDashboard }`.
- i18n keys (EN / DE):
  - `nav.technicians`: "Technicians" / "Monteure"
  - `dashboard.title`: "Welcome to Werkbank Digital" / "Willkommen bei Werkbank Digital"
  - `dashboard.body`: "Customers, quotes and invoices will appear here soon. Start by adding your technicians." / "Hier siehst du bald Kunden, Angebote und Rechnungen. Leg zuerst deine Monteure an."
  - `dashboard.cta`: "Add technicians" / "Monteure anlegen"
- Assets: placeholder mark (a 32×32 rounded tile with a "W"), favicon (same SVG), `email-mark.png` 48×48 rendered from the SVG with `npx playwright screenshot --viewport-size=48,48 file://$PWD/public/werkbank/mark.svg public/werkbank/email-mark.png`. The owner replaces them with the real logo later.

- [ ] **Step 1: Write failing tests:** WerkbankDashboard shows the title and the CTA linking to `/technicians` for admin and producer, no CTA for artist; `visibleNavItems(NAV_ITEMS, ctx({ roles: ["admin"], orgKind: "handwerk" }))` labels equal `["Dashboard","Technicians","Settings"]`; for production the list is unchanged; keyParity covers `werkbank`.
- [ ] **Step 2: Run** `npx vitest run src/features/werkbank src/components/layout src/i18n`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2 command. Expected: PASS (copyLint covers the new namespace automatically).
- [ ] **Step 5: Commit** `add the werkbank shell, dashboard and brand assets`.

### Task 14: Technicians page

**Files:**
- Create: `src/features/werkbank/data/technicians.ts` (+ test), `src/features/werkbank/hooks/useTechnicians.ts` (+ test), `src/features/werkbank/pages/TechniciansPage.tsx` (+ test), `src/features/werkbank/components/AddTechnicianDialog.tsx`
- Modify: `src/features/werkbank/ui.ts` (route `{ path: "/technicians", kinds: ["handwerk"], requiredRoles: ["admin","producer"], Page: TechniciansPage }`), both i18n JSON files

**Interfaces:**
- Produces:
  ```ts
  export type TechnicianAccount = "active" | "invited" | "none";
  export interface Technician { id: string; name: string; email: string | null; phone: string | null; account: TechnicianAccount }
  export async function fetchTechnicians(client: SupabaseClient<Database>, orgId: string): Promise<Technician[]>;
  export async function createTechnician(client, args: { orgId: string; name: string; email: string; phone: string | null }): Promise<{ id: string }>;
  ```
  `fetchTechnicians` selects `id, name, email, phone, user_id` from `artists` where `org_id = orgId` ordered by `name`, and marks `account` as `active` when `user_id` is set, `invited` when the id is in `fetchPendingInvitedArtistIds(client, orgId)`, else `none`. `createTechnician` inserts the `artists` row, then calls `inviteArtistToApp(client, { orgId, artistId, email })`.
- Hooks: `useTechnicians(orgId)` (queryKey `["artists", "technicians", orgId]`), `useCreateTechnician(orgId)` invalidating `["artists"]` (domain-prefix rule).
- Page: table Name, E-Mail, Telefon, Konto; account pill via `StatusPill` (`active` → "Aktiv"/"Active", `invited` → "Eingeladen"/"Invited", `none` → "Kein Konto"/"No account"); "Monteur anlegen"/"Add technician" opens the dialog (name required, email required and validated with zod `.email()`, phone optional); `EmptyState` "Noch keine Monteure"/"No technicians yet". Resend and revoke reuse `useInvitationMutations(orgId)` with the pending invitation ids from `usePendingArtistInvitations`.

- [ ] **Step 1: Write failing tests:**
  - data: with fake `artists` rows (one with `user_id`, one pending, one neither) and `rpc:list_pending_invited_artists` returning the pending id, `fetchTechnicians` returns accounts `["active","invited","none"]`.
  - data: `createTechnician` records an `artists` insert with `org_id` and then `fn:create-invitation` with `artist_id`, `role: "artist"`.
  - data: a failing insert rejects and makes no invitation call.
  - page: renders the three pills; submitting the dialog with an invalid email shows the validation message and makes no call.
- [ ] **Step 2: Run** `npx vitest run src/features/werkbank`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** Step 2 command and `npm run lint`. Expected: PASS, no boundary violations.
- [ ] **Step 5: Commit** `add the werkbank technicians page`.

### Task 15: The `werkbank` schema

**Files:**
- Create: `supabase/migrations/20261006140000_werkbank_schema.sql`, `supabase/tests/werkbank/isolation.test.sql`
- Modify: `supabase/config.toml` (new `[api]` section: `schemas = ["public", "graphql_public", "werkbank"]`), regenerated types (`--schema public,werkbank`)

- [ ] **Step 1: Write the failing pgTAP test:** `has_schema('werkbank')`; and zero rows from a `pg_depend` join where the dependent object's namespace is `public` and the referenced object's namespace is `werkbank` (cover `pg_class`, `pg_proc` and view rewrite rules via `pg_rewrite`). Create a temp table `werkbank.t` and a public view on it inside the test to prove the query detects a violation (`isnt_empty`), then drop both before the real assertion.
- [ ] **Step 2: Run** `npm run test:db`. Expected: FAIL (`schema "werkbank" does not exist`).
- [ ] **Step 3: Write the migration:** `create schema werkbank; grant usage on schema werkbank to authenticated, service_role;` plus `alter default privileges in schema werkbank grant select, insert, update, delete on tables to authenticated, service_role; ... grant execute on functions to authenticated, service_role;`. Update `config.toml`; restart the local stack (`npm run local:down && npm run local:up`); regenerate types.
- [ ] **Step 4: Run** `npm run test:db && npm run sync:mirrors:check && npx tsc -p tsconfig.app.json --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `create the werkbank schema with an isolation test`.

### Task 16 (closes PR 2): End-to-end smoke and docs

**Files:**
- Create: `e2e/werkbank-foundation.spec.ts`
- Modify: `CLAUDE.md` (Werkbank section, about 15 lines)

- [ ] **Step 1: Write the smoke test** following `e2e/platform-console.spec.ts`: `ensurePlatformAdmin`, super-admin creates org "E2E Werkbank" with workspace type "Handwerksbetrieb" in New organization; then with `adminClient()` add a confirmed user as `admin` member (helpers from `e2e/helpers/users.ts`) and log in as that user. Assert: sidebar shows "Werkbank Digital" and "Monteure"; does not show "Termine"/"Dates", "Hilfe"/"Help", "Chats"; `/dates` redirects to `/today`; Settings, Organization shows the workspace type disabled (Review Focus 1); "Monteur anlegen" with name and a tagged email adds a row with "Eingeladen". `afterAll` deletes the org and users.
- [ ] **Step 2: Run** `npm run verify:full`. Expected: all layers PASS including the new e2e spec.
- [ ] **Step 3: Write the CLAUDE.md section** "Werkbank module": what it is (ADR-0013 link), the plugin paths, the rule that core code never names the module outside the manifests, the guards, and that Werkbank tables live in schema `werkbank` accessed via `supabase.schema('werkbank')`.
- [ ] **Step 4: Run** `npx vitest run scripts/moduleIsolation.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `add werkbank e2e smoke test and claude.md section`. Open PR 2 with: "No help center impact (Werkbank help starts in Teil 2)", "No mini: shell pages", no changelog, and the go-live reminder that production "Exposed schemas" must include `werkbank`.
