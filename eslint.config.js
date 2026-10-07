import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

// Wave 2 (ADR 0012): UI convention lint is active (sweep complete). Its rules are
// 'error' and the lint script runs --max-warnings 0, so any raw value fails CI.
import { uiConventions } from './eslint/ui-conventions.js';

// All three rules are errors and the lint script runs with --max-warnings 0:
// any new violation fails CI. The `any` boundary policy lives in CLAUDE.md
// ("TypeScript" section).
const strictness = {
  "@typescript-eslint/no-unused-vars": [
    "error",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
    },
  ],
  "@typescript-eslint/no-explicit-any": "error",
};

// eslint-plugin-react-hooks v7's `recommended` preset is the full React Compiler
// rule family (rules-of-hooks, exhaustive-deps, set-state-in-effect, refs,
// immutability, purity, globals, ...). We adopt it: the lint script runs
// --max-warnings 0, so both the error- and warn-level rules are enforced.
const reactHooksRules = {
  ...reactHooks.configs.recommended.rules,
  // `incompatible-library` is a React Compiler adoption advisory ("Compilation
  // Skipped: Use of incompatible library") — it fires on react-hook-form's
  // watch/register/handleSubmit. This project builds with @vitejs/plugin-react-swc,
  // NOT the React Compiler, so the advisory has no runtime meaning here and
  // react-hook-form is fully supported. Off.
  "react-hooks/incompatible-library": "off",
};

// The React Compiler correctness rules target authored component render/effects.
// Two file groups aren't that: src/components/ui/** is vendored shadcn (regenerated,
// never hand-edited per CLAUDE.md) and test files exercise harness/probe code that
// no compiler optimizes. Keep rules-of-hooks + exhaustive-deps on for both; switch
// off the compiler subset that otherwise fights generated primitives and test probes.
const reactCompilerRulesOff = {
  "react-hooks/set-state-in-effect": "off",
  "react-hooks/set-state-in-render": "off",
  "react-hooks/refs": "off",
  "react-hooks/immutability": "off",
  "react-hooks/purity": "off",
  "react-hooks/globals": "off",
  "react-hooks/static-components": "off",
  "react-hooks/use-memo": "off",
  "react-hooks/preserve-manual-memoization": "off",
  "react-hooks/error-boundaries": "off",
};

// Module isolation (ADR 0013). The Werkbank plugin must stay removable: core code
// reaches it only through the module manifests, and it never reaches into
// Showflow's booking domain. ESLint keeps only the LAST matching config object's
// options for a rule per file, and uiConventions (src/**) is appended last and sets
// `no-restricted-imports` and `no-restricted-syntax`. So the isolation objects below
// come after it and repeat its Design System import pattern and its syntax
// selectors for the src files it covers.
//
// Static imports use `no-restricted-imports` (gitignore-style patterns via
// node-ignore: no brace expansion, hence expand(); `dir/**` does not match the bare
// `dir`, hence both forms). Dynamic `import()` is invisible to that rule, so the same
// paths are mirrored as ImportExpression selectors in `no-restricted-syntax`.
const expand = (prefix, names, suffix = "*") => names.map((name) => `${prefix}${name}${suffix}`);

const bookingData = ["bookings", "shows", "showDates", "showAssignments", "casts", "hireOrders", "airtable"];
const bookingHooks = ["Booking", "Shows", "ShowDates", "HireOrders", "Airtable"];
const bookingComponents = ["bookings", "shows", "casts", "hireOrders", "availability"];
const sharedBookingModules = ["bookingFlow", "hireOrders", "airtable", "eligibility"];

const bookingDomainPatterns = [
  {
    group: [
      ...expand("**/data/", bookingData),
      ...expand("**/hooks/use", bookingHooks),
      ...expand("**/components/", bookingComponents, ""),
      ...expand("**/components/", bookingComponents, "/**"),
      "**/lib/hireOrders",
      "**/lib/hireOrders/**",
      ...expand("**/_shared/", sharedBookingModules),
      // Inside _shared/werkbank/ the same modules are reached as siblings of the plugin folder.
      ...expand("../", sharedBookingModules),
      ...expand("../../", sharedBookingModules),
    ],
    message:
      "The plugin must not depend on Showflow's booking domain (ADR 0013). Go through a kind-neutral core extension point instead.",
  },
];

const pluginImportPatterns = [
  {
    group: ["**/features/werkbank", "**/features/werkbank/**", "**/_shared/werkbank", "**/_shared/werkbank/**"],
    message:
      "Core code must not import the Werkbank plugin (ADR 0013). Register it in a module manifest: src/modules/*.ts or supabase/functions/_shared/modules.ts.",
  },
];

const designSystemPatterns = uiConventions.rules["no-restricted-imports"][1].patterns;
const uiConventionSelectors = uiConventions.rules["no-restricted-syntax"].slice(1);

// Regex sources mirroring the pattern groups above. esquery ends a regex at the
// first "/", so every slash is written as \u002F.
const alt = (names) => `(${names.join("|")})`;
const toSelector = (source, message) => ({
  selector: `ImportExpression[source.value=/${source.replaceAll("/", "\\u002F")}/]`,
  message,
});
const bookingDomainSource = [
  `(^|/)data/${alt(bookingData)}`,
  `(^|/)hooks/use${alt(bookingHooks)}`,
  `(^|/)components/${alt(bookingComponents)}(/|$)`,
  `(^|/)lib/hireOrders(/|$)`,
  `(^|/)_shared/${alt(sharedBookingModules)}`,
  `^(\\.\\./){1,2}${alt(sharedBookingModules)}`,
].join("|");
const pluginImportSource = "(^|/)(features|_shared)/werkbank(/|$)";
const bookingDomainDynamic = toSelector(bookingDomainSource, bookingDomainPatterns[0].message);
const pluginImportDynamic = toSelector(pluginImportSource, pluginImportPatterns[0].message);

const srcPluginPaths = ["src/features/werkbank/**"];
const edgePluginPaths = ["supabase/functions/werkbank-*/**", "supabase/functions/_shared/werkbank/**"];
const manifestPaths = ["src/modules/*.ts", "supabase/functions/_shared/modules.ts"];

const isolationRules = (patterns, selectors) => ({
  "no-restricted-imports": ["error", { patterns }],
  "no-restricted-syntax": ["error", ...selectors],
});

const moduleIsolation = [
  // The plugin, all files: no booking-domain imports (static or dynamic).
  {
    files: [...srcPluginPaths, ...edgePluginPaths].map((glob) => `${glob}/*.{ts,tsx}`),
    rules: isolationRules(bookingDomainPatterns, [bookingDomainDynamic]),
  },
  // Plugin src that uiConventions covers: the same, plus its Design System import
  // ban and syntax selectors (this object wins over the one above for these files).
  {
    files: srcPluginPaths.map((glob) => `${glob}/*.{ts,tsx}`),
    ignores: uiConventions.ignores,
    rules: isolationRules(
      [...bookingDomainPatterns, ...designSystemPatterns],
      [...uiConventionSelectors, bookingDomainDynamic],
    ),
  },
  // Core src: no plugin imports outside the manifests, plus uiConventions' rules
  // for the files it covers.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [...srcPluginPaths, ...manifestPaths, ...uiConventions.ignores],
    rules: isolationRules(
      [...pluginImportPatterns, ...designSystemPatterns],
      [...uiConventionSelectors, pluginImportDynamic],
    ),
  },
  // The one core file that may mount a plugin component: the Settings page renders the
  // Werkbank numbering and company tabs. Same rules as core src, but the plugin ban names every plugin
  // path except that one component. Later in the list, so it wins for this file.
  {
    files: ["src/pages/SettingsPage.tsx"],
    rules: isolationRules(
      [
        {
          // gitignore semantics: a file cannot be re-included once its directory is excluded, so
          // the components folder is banned file by file (the plugin root is listed by its top-level files) and the one allowed file is negated.
          group: [
            "**/features/werkbank/ui*",
            "**/features/werkbank/paths*",
            "**/features/werkbank/registry*",
            "**/features/werkbank/index*",
            ...["data", "hooks", "lib", "pages", "schemas", "i18n"].map((dir) => `**/features/werkbank/${dir}`),
            ...["data", "hooks", "lib", "pages", "schemas", "i18n"].map((dir) => `**/features/werkbank/${dir}/**`),
            "**/features/werkbank/components/*",
            "!**/features/werkbank/components/NumberingTab",
            "!**/features/werkbank/components/CompanyTab",
            "**/_shared/werkbank",
            "**/_shared/werkbank/**",
          ],
          message: pluginImportPatterns[0].message,
        },
        ...designSystemPatterns,
      ],
      [...uiConventionSelectors, pluginImportDynamic],
    ),
  },
  // Core src that uiConventions exempts (vendored ui, tests, pdf/email themes):
  // the plugin ban only, so their other behaviour is unchanged.
  {
    files: uiConventions.ignores,
    ignores: [...srcPluginPaths, ...manifestPaths],
    rules: isolationRules(pluginImportPatterns, [pluginImportDynamic]),
  },
  // Core edge functions.
  {
    files: ["supabase/functions/**/*.{ts,tsx}"],
    ignores: [...edgePluginPaths, ...manifestPaths],
    rules: isolationRules(pluginImportPatterns, [pluginImportDynamic]),
  },
];

export default tseslint.config(
  // Build output and the v8 coverage HTML report (both gitignored — ESLint does
  // not read .gitignore). `npm run test:coverage` writes coverage/, whose vendored
  // istanbul report scripts otherwise trip --max-warnings 0 on the next lint.
  // `supabase/.temp` is the Supabase CLI's scratch dir (edge-runtime bootstrap,
  // pooler URL, etc.), created whenever the local stack is running. Its generated,
  // single-line index.ts trips --max-warnings 0, so a running stack must not make
  // `npm run lint` fail — same reasoning as coverage/ above.
  { ignores: ["dist", "coverage", "supabase/.temp", ".claude/worktrees/**"] },
  // App, tests, e2e, scripts — browser runtime, Vite fast refresh.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    ignores: ["supabase/functions/**"],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooksRules,
      "react-refresh/only-export-components": ["error", { allowConstantExport: true }],
      ...strictness,
    },
  },
  // shadcn primitives are generated (never hand-edited) and the test harness
  // is never HMR'd — fast-refresh hygiene is meaningless in both. These
  // context modules deliberately co-locate provider + hooks (editing them
  // full-reloads the dev server; accepted). Splitting them for fast refresh
  // is deferred to a standalone PR — that PR deletes this carve-out.
  //
  // render.tsx is the hire-order PDF document: dual-homed (byte-identical
  // with its generated supabase/functions/ mirror, which is why it can't
  // just export buildStyles/renderHireOrderPdf from a second file) and never
  // mounted as a live DOM component, so Fast Refresh has nothing to do with
  // it either way — it's called once to produce PDF bytes, in the browser
  // (settings preview) or on the edge (issue/download).
  {
    files: [
      "src/components/ui/**",
      "src/test/**",
      "src/features/auth/AuthContext.tsx",
      "src/features/editor/EditorContext.tsx",
      "src/features/demo/DemoContext.tsx",
      "src/features/consent/ConsentContext.tsx",
      "src/features/i18n/LanguageContext.tsx",
      "src/lib/hireOrders/pdf/render.tsx",
    ],
    rules: { "react-refresh/only-export-components": "off" },
  },
  // Deno edge functions: server runtime. No Vite fast refresh (the React
  // Email templates are rendered server-side, never HMR'd) and no browser
  // globals. rules-of-hooks still applies to the email template components.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["supabase/functions/**/*.{ts,tsx}"],
    languageOptions: { ecmaVersion: 2020, globals: { Deno: "readonly" } },
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooksRules,
      ...strictness,
    },
  },
  // Vendored shadcn primitives: React Compiler correctness rules off (see above).
  {
    files: ["src/components/ui/**"],
    plugins: { "react-hooks": reactHooks },
    rules: reactCompilerRulesOff,
  },
  // Test harness/probe code: React Compiler correctness rules off (see above).
  {
    files: ["**/*.test.{ts,tsx}", "src/test/**"],
    plugins: { "react-hooks": reactHooks },
    rules: reactCompilerRulesOff,
  },
  uiConventions,
  ...moduleIsolation,
);
