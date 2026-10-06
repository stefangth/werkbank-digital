// Org kinds live twice: the TypeScript registry (src/lib/orgKind.ts, composed from module
// manifests) and the `public.org_kinds` rows the migrations insert. The edge function
// validates with the first, `provision_org` and `set_org_kind` with the second, so a kind
// added on one side only fails late. This test replays the migrations' inserts and deletes
// and pins both sides, including the two behaviour flags, to each other.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ORG_KINDS, ORG_KIND_DEFS } from "../src/lib/orgKind";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(repoRoot, "supabase", "migrations");

interface KindRow { seedsStarterCatalog: boolean; switchableByOrgAdmin: boolean }

const INSERT = /insert\s+into\s+public\.org_kinds\s*\(\s*kind\s*,\s*seeds_starter_catalog\s*,\s*switchable_by_org_admin\s*\)\s*values\s*([^;]+);/gi;
const TUPLE = /\(\s*'([^']+)'\s*,\s*(true|false)\s*,\s*(true|false)\s*\)/gi;
const DELETE = /delete\s+from\s+public\.org_kinds\s+where\s+kind\s*=\s*'([^']+)'/gi;

/** Replay org_kinds inserts and deletes in migration order. */
export function replayOrgKinds(migrations: { name: string; sql: string }[]): Map<string, KindRow> {
  const kinds = new Map<string, KindRow>();
  for (const { sql } of [...migrations].sort((a, b) => a.name.localeCompare(b.name))) {
    const events: { at: number; apply: () => void }[] = [];
    for (const insert of sql.matchAll(INSERT)) {
      for (const tuple of insert[1].matchAll(TUPLE)) {
        const [, kind, seeds, switchable] = tuple;
        events.push({
          at: insert.index ?? 0,
          apply: () => kinds.set(kind, { seedsStarterCatalog: seeds.toLowerCase() === "true", switchableByOrgAdmin: switchable.toLowerCase() === "true" }),
        });
      }
    }
    for (const del of sql.matchAll(DELETE)) {
      events.push({ at: del.index ?? 0, apply: () => kinds.delete(del[1]) });
    }
    events.sort((a, b) => a.at - b.at).forEach((e) => e.apply());
  }
  return kinds;
}

const migrations = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((name) => ({ name, sql: readFileSync(join(migrationsDir, name), "utf8") }));

describe("org kinds: TypeScript registry vs org_kinds rows", () => {
  it("replays inserts and deletes in migration order", () => {
    const kinds = replayOrgKinds([
      { name: "2_drop.sql", sql: "delete from public.org_kinds where kind = 'b';" },
      { name: "1_add.sql", sql: "insert into public.org_kinds (kind, seeds_starter_catalog, switchable_by_org_admin) values ('a', true, false), ('b', false, true);" },
    ]);
    expect([...kinds.keys()]).toEqual(["a"]);
    expect(kinds.get("a")).toEqual({ seedsStarterCatalog: true, switchableByOrgAdmin: false });
  });

  it("the migrations register exactly the kinds the registry knows", () => {
    expect([...replayOrgKinds(migrations).keys()].sort()).toEqual([...ORG_KINDS].sort());
  });

  it("each kind's flags match its registry definition", () => {
    for (const [kind, row] of replayOrgKinds(migrations)) {
      const def = ORG_KIND_DEFS[kind as keyof typeof ORG_KIND_DEFS];
      expect({ kind, ...row }).toEqual({ kind, seedsStarterCatalog: def.seedsStarterCatalog, switchableByOrgAdmin: def.switchableByOrgAdmin });
    }
  });
});
