// Removability guard (ADR 0013): the plugin's name and its kind identifier may
// appear only in the plugin's own paths, the module manifests, docs and the few
// generated or config files listed below. Anywhere else the core would know about
// the plugin, and deleting the plugin would no longer be a clean removal.
//
// The import direction (core -> plugin only through manifests, plugin -> booking
// domain never) is enforced by ESLint no-restricted-imports in eslint.config.js.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

export type ModuleGuard = {
  name: string;
  /** What must not leak outside `allowed`. */
  forbidden: RegExp;
  /** Glob-ish patterns: `**` crosses directories, `*` stays within one path segment. */
  allowed: readonly string[];
};

/** One entry per removable module; each module owns its allow-list. */
export const MODULES: readonly ModuleGuard[] = [
  {
    name: "werkbank",
    forbidden: /werkbank|handwerk/i,
    allowed: [
      "src/features/werkbank/**",
      "supabase/functions/werkbank-*/**",
      "supabase/functions/_shared/werkbank/**",
      "supabase/migrations/*_werkbank_*.sql",
      "supabase/tests/werkbank/**",
      "public/werkbank/**",
      "e2e/werkbank-*.spec.ts",
      "src/modules/*.ts",
      "supabase/functions/_shared/modules.ts",
      "docs/**",
      "CLAUDE.md",
      "README.md",
      "scripts/mirrors.manifest.json",
      "supabase/config.toml",
      "src/integrations/supabase/types.ts",
      "supabase/functions/_shared/database.types.ts",
      "eslint.config.js",
      "scripts/moduleIsolation.test.ts",
    ],
  },
];

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico", ".pdf", ".woff", ".woff2",
  ".ttf", ".otf", ".eot", ".zip", ".gz", ".mp3", ".mp4", ".mov", ".webm", ".wasm",
]);

function globToRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      out += ".*";
      i++;
      if (glob[i + 1] === "/") i++;
    } else if (c === "*") {
      out += "[^/]*";
    } else {
      out += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${out}$`);
}

const isAllowed = (path: string, allowed: readonly string[]): boolean =>
  allowed.some((glob) => globToRegExp(glob).test(path));

/** One entry per file that mentions a module outside its allowed paths, e.g. "src/a.ts (werkbank)". */
export function findViolations(
  files: { path: string; text: string }[],
  modules: readonly ModuleGuard[] = MODULES,
): string[] {
  return modules.flatMap((m) =>
    files.filter((f) => m.forbidden.test(f.text) && !isAllowed(f.path, m.allowed)).map((f) => `${f.path} (${m.name})`),
  );
}

function trackedTextFiles(): { path: string; text: string }[] {
  const listed = execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const files: { path: string; text: string }[] = [];
  for (const path of listed.split("\0").filter(Boolean)) {
    if (path.startsWith(".superpowers/") || BINARY_EXTENSIONS.has(extname(path).toLowerCase())) continue;
    let buf: Buffer;
    try {
      buf = readFileSync(join(repoRoot, path));
    } catch {
      continue; // listed but deleted in the working tree
    }
    if (buf.subarray(0, 8192).includes(0)) continue; // NUL byte: binary
    files.push({ path, text: buf.toString("utf8") });
  }
  return files;
}

describe("module isolation (ADR 0013)", () => {
  it("flags a mention in a core file", () => {
    expect(findViolations([{ path: "src/pages/X.tsx", text: "const kind = 'handwerk';" }])).toEqual([
      "src/pages/X.tsx (werkbank)",
    ]);
  });

  it("matches case-insensitively and reports every offending file", () => {
    const hits = findViolations([
      { path: "src/a.ts", text: "Werkbank" },
      { path: "supabase/functions/booking/index.ts", text: "// HANDWERK" },
      { path: "src/clean.ts", text: "nothing here" },
    ]);
    expect(hits).toEqual(["src/a.ts (werkbank)", "supabase/functions/booking/index.ts (werkbank)"]);
  });

  it("allows mentions inside the plugin and manifest paths", () => {
    const text = "werkbank handwerk";
    const paths = [
      "src/features/werkbank/index.ts",
      "src/features/werkbank/pages/A.tsx",
      "supabase/functions/werkbank-invoice/index.ts",
      "supabase/functions/_shared/werkbank/x.ts",
      "supabase/migrations/20261101000000_werkbank_schema.sql",
      "supabase/tests/werkbank/a.sql",
      "public/werkbank/logo.svg",
      "e2e/werkbank-smoke.spec.ts",
      "src/modules/registry.ts",
      "supabase/functions/_shared/modules.ts",
      "docs/adr/0013-werkbank-as-removable-module.md",
      "CLAUDE.md",
      "eslint.config.js",
      "scripts/moduleIsolation.test.ts",
    ];
    expect(findViolations(paths.map((path) => ({ path, text })))).toEqual([]);
  });

  it("does not let a single star cross directories", () => {
    const text = "werkbank";
    expect(
      findViolations([
        { path: "src/modules/nested/x.ts", text },
        { path: "supabase/migrations/20261101000000_other.sql", text },
        { path: "supabase/functions/werkbank-x", text }, // no segment after the prefix dir
      ]),
    ).toEqual([
      "src/modules/nested/x.ts (werkbank)",
      "supabase/migrations/20261101000000_other.sql (werkbank)",
      "supabase/functions/werkbank-x (werkbank)",
    ]);
  });

  it("keeps a separate allow-list per module and names the module in each violation", () => {
    const modules: ModuleGuard[] = [
      { name: "alpha", forbidden: /alpha/, allowed: ["src/alpha/**", "docs/**"] },
      { name: "beta", forbidden: /beta/, allowed: ["src/beta/**", "docs/**"] },
    ];
    expect(
      findViolations(
        [
          { path: "src/alpha/a.ts", text: "alpha beta" }, // beta leaks into alpha's folder
          { path: "src/beta/b.ts", text: "alpha beta" }, // alpha leaks into beta's folder
          { path: "src/alpha/ok.ts", text: "alpha" },
          { path: "src/core.ts", text: "alpha" },
          { path: "docs/x.md", text: "alpha beta" },
        ],
        modules,
      ),
    ).toEqual(["src/beta/b.ts (alpha)", "src/core.ts (alpha)", "src/alpha/a.ts (beta)"]);
  });

  it("finds no mention of the plugin outside its allowed paths in the tracked tree", () => {
    expect(findViolations(trackedTextFiles())).toEqual([]);
  });
});
