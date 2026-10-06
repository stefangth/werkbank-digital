import { assertEquals } from "./test-asserts.ts";
import { inviteRoleLabel, resolveInviteRoleLabel } from "./roles.ts";
import { makeFakeDeps } from "./testing.ts";
import { ORG_KIND_DEFS, VOCABULARY } from "./orgKind.ts";

Deno.test("inviteRoleLabel: staffing email keeps today's English label in German", () => {
  assertEquals(inviteRoleLabel("producer", "staffing", "de"), "Production Team");
});

Deno.test("inviteRoleLabel: production email is unchanged in both locales", () => {
  assertEquals(inviteRoleLabel("producer", "production", "en"), "Production Team");
  assertEquals(inviteRoleLabel("producer", "production", "de"), "Production Team");
  assertEquals(inviteRoleLabel("artist", "production", "de"), "Artist");
  assertEquals(inviteRoleLabel("admin", "staffing", "de"), "Admin");
});

// --- resolveInviteRoleLabel -------------------------------------------------

Deno.test("resolveInviteRoleLabel: production org gets today's label and never reads app_settings", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: { organizations: [{ when: { id: "org1" }, data: { org_kind: "production" } }] },
  });
  assertEquals(await resolveInviteRoleLabel(deps.admin, "org1", "producer"), "Production Team");
  assertEquals(calls.some((c) => c.table === "app_settings"), false);
});

Deno.test("resolveInviteRoleLabel: staffing org keeps the English label and never reads app_settings", async () => {
  const { deps, calls } = makeFakeDeps({
    tables: {
      organizations: [{ when: { id: "org1" }, data: { org_kind: "staffing" } }],
      app_settings: { data: null, error: { message: "boom" } },
    },
  });
  assertEquals(await resolveInviteRoleLabel(deps.admin, "org1", "producer"), "Production Team");
  assertEquals(calls.some((c) => c.table === "app_settings"), false);
});

Deno.test("resolveInviteRoleLabel: an organizations read error falls back to production", async () => {
  const { deps } = makeFakeDeps({ tables: { organizations: { data: null, error: { message: "boom" } } } });
  assertEquals(await resolveInviteRoleLabel(deps.admin, "org1", "producer"), "Production Team");
});

/** Register a kind that follows the UI language for the duration of one test. */
async function withFollowKind(run: () => Promise<void>) {
  const production = ORG_KIND_DEFS.production;
  const vocabulary = {
    en: { ...production.vocabulary.en, roleProducer: "Office", roleArtist: "Technician" },
    de: { ...production.vocabulary.de, roleProducer: "Buero", roleArtist: "Techniker" },
  };
  const defs = ORG_KIND_DEFS as unknown as Record<string, unknown>;
  const vocab = VOCABULARY as unknown as Record<string, unknown>;
  defs.fakefollow = { ...production, kind: "fakefollow", roleLabelsFollowUiLanguage: true, vocabulary };
  vocab.fakefollow = vocabulary;
  try {
    await run();
  } finally {
    delete defs.fakefollow;
    delete vocab.fakefollow;
  }
}

Deno.test("resolveInviteRoleLabel: a UI-language kind in German gets the German label", async () => {
  await withFollowKind(async () => {
    const { deps } = makeFakeDeps({
      tables: {
        organizations: [{ when: { id: "org1" }, data: { org_kind: "fakefollow" } }],
        app_settings: [{ when: { key: "org_language" }, data: [{ org_id: "org1", value: "de" }] }],
      },
      rpcs: { is_feature_enabled: { data: true, error: null } },
    });
    assertEquals(await resolveInviteRoleLabel(deps.admin, "org1", "artist"), "Techniker");
  });
});

Deno.test("resolveInviteRoleLabel: a failing app_settings read degrades to English instead of throwing", async () => {
  await withFollowKind(async () => {
    const { deps, calls } = makeFakeDeps({
      tables: {
        organizations: [{ when: { id: "org1" }, data: { org_kind: "fakefollow" } }],
        app_settings: { data: null, error: { message: "boom" } },
      },
    });
    assertEquals(await resolveInviteRoleLabel(deps.admin, "org1", "producer"), "Office");
    assertEquals(calls.some((c) => c.table === "app_settings"), true, "the locale read was attempted");
  });
});
