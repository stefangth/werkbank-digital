import { assertEquals } from "../test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../testing.ts";
import { handle } from "../../provision-org/index.ts";

const body = {
  name: "Acme Bau",
  slug: "acme-bau",
  admin_email: "a@acme.com",
  role: "admin",
  app_origin: "https://app.test",
  org_kind: "handwerk",
};

function fake() {
  return makeFakeDeps({
    authUser: { id: "u1" },
    tables: {
      platform_admins: { data: { user_id: "u1" }, error: null },
      organizations: [{ when: { id: "org-9" }, data: { org_kind: "handwerk" } }],
      app_settings: [{ when: { key: "org_language" }, data: [{ org_id: "org-9", value: "de" }] }],
    },
    rpcs: {
      provision_org: { data: { org_id: "org-9", token: "tok-9" }, error: null },
      is_feature_enabled: { data: true, error: null },
    },
    usersById: {},
    generateLinkResult: { data: { properties: { action_link: "https://app.test/reset-password?redirect=x" } }, error: null },
  });
}

Deno.test("provision-org (handwerk): kind defaults beat the request body, settings are seeded, no booking-flow seed", async () => {
  const { deps, calls } = fake();
  const res = await handle(
    makeRequest({ headers: { Authorization: "Bearer x" }, body: { ...body, entitlements: { booking_flow: true } } }),
    deps,
  );
  assertEquals(res.status, 200);

  const insert = calls.find((c) => c.table === "org_entitlements" && c.method === "insert");
  const rows = insert!.args[0] as { feature: string; enabled: boolean }[];
  assertEquals(rows.find((r) => r.feature === "booking_flow")?.enabled, false);
  assertEquals(rows.find((r) => r.feature === "hire_orders")?.enabled, false);
  assertEquals(rows.find((r) => r.feature === "language_packages")?.enabled, true);

  const upserts = calls.filter((c) => c.table === "app_settings" && c.method === "upsert");
  const upserted = upserts.flatMap((c) => c.args[0] as { key: string; value: unknown }[]);
  assertEquals(upserted.some((r) => r.key === "org_language" && r.value === "de"), true);
  assertEquals(upserted.some((r) => r.key === "booking_flow"), false);
  assertEquals(upserts.length, 1);
});

Deno.test("provision-org (handwerk): the first admin's invitation email says Admin", async () => {
  const { deps, invokeCalls } = fake();
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  assertEquals(sent.length, 1);
  const msg = sent[0].body as { templateData: { role: string; roleKey: string } };
  assertEquals(msg.templateData.role, "Admin");
  assertEquals(msg.templateData.roleKey, "admin");
});

Deno.test("provision-org (handwerk): a technician as first invitee is labelled Monteur", async () => {
  const { deps, invokeCalls } = fake();
  const res = await handle(makeRequest({ headers: { Authorization: "Bearer x" }, body: { ...body, role: "artist" } }), deps);
  assertEquals(res.status, 200);
  const sent = invokeCalls.filter((c) => c.name === "send-transactional-email");
  const msg = sent[0].body as { templateData: { role: string } };
  assertEquals(msg.templateData.role, "Monteur");
});
