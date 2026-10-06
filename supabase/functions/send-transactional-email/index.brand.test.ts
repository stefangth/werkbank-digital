/**
 * Brand-aware sender resolution for send-transactional-email: a brand with its own
 * defaultFrom sends from the org's own resend_from_address row, else from that default,
 * never from the platform (showflow) default. A brand without defaultFrom keeps the
 * existing org override ?? platform default ?? built-in fallback chain.
 */
import { assertEquals } from "../_shared/test-asserts.ts";
import { asTypedClient, createFakeClient } from "../_shared/testing.ts";
import type { BrandDef } from "../_shared/brand.ts";
import { BOOKING_ENGINE_DEFAULTS } from "../_shared/settings.ts";
import { resolveFromAddress } from "./index.ts";

const ORG_ID = "org-1";

function brand(defaultFrom: string | null): BrandDef {
  return {
    key: "test",
    name: "Test Brand",
    markSvgPath: null,
    emailMarkPath: "/t.png",
    faviconPath: "/t.svg",
    appUrl: "https://t.example",
    hosts: [],
    defaultFrom,
  };
}

const PLATFORM_ROW = { org_id: null, value: "Platform <p@showflow.example>" };
const ORG_ROW = { org_id: ORG_ID, value: "Org <o@org.example>" };

Deno.test("brand defaultFrom: no org row sends from the brand default, not the platform row", async () => {
  const { client } = createFakeClient({
    tables: {
      app_settings: [
        { when: { key: "resend_from_address", org_id: ORG_ID }, data: null },
        { data: [PLATFORM_ROW] },
      ],
    },
  });
  const from = await resolveFromAddress(asTypedClient(client), ORG_ID, brand("Test <a@t.example>"));
  assertEquals(from, "Test <a@t.example>");
});

Deno.test("brand defaultFrom: the org's own row wins over the brand default", async () => {
  const { client } = createFakeClient({
    tables: {
      app_settings: [
        { when: { key: "resend_from_address", org_id: ORG_ID }, data: { value: ORG_ROW.value } },
      ],
    },
  });
  const from = await resolveFromAddress(asTypedClient(client), ORG_ID, brand("Test <a@t.example>"));
  assertEquals(from, "Org <o@org.example>");
});

Deno.test("brand defaultFrom: an org row holding JSON null falls back to the brand default", async () => {
  const { client } = createFakeClient({
    tables: {
      app_settings: [
        { when: { key: "resend_from_address", org_id: ORG_ID }, data: { value: null } },
      ],
    },
  });
  const from = await resolveFromAddress(asTypedClient(client), ORG_ID, brand("Test <a@t.example>"));
  assertEquals(from, "Test <a@t.example>");
});

Deno.test("brand without defaultFrom keeps the org override ?? platform default chain", async () => {
  const platformOnly = createFakeClient({ tables: { app_settings: { data: [PLATFORM_ROW] } } });
  assertEquals(
    await resolveFromAddress(asTypedClient(platformOnly.client), ORG_ID, brand(null)),
    PLATFORM_ROW.value,
  );

  const withOrg = createFakeClient({ tables: { app_settings: { data: [PLATFORM_ROW, ORG_ROW] } } });
  assertEquals(
    await resolveFromAddress(asTypedClient(withOrg.client), ORG_ID, brand(null)),
    ORG_ROW.value,
  );

  const none = createFakeClient({ tables: { app_settings: { data: [] } } });
  assertEquals(
    await resolveFromAddress(asTypedClient(none.client), ORG_ID, brand(null)),
    BOOKING_ENGINE_DEFAULTS.resend_from_address,
  );
});
