/** Optional reply_to forwarding to Resend. */
import { assertEquals, assertExists } from "../_shared/test-asserts.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";
import { handle } from "./index.ts";

const authedReq = (o: Parameters<typeof makeRequest>[0] = {}) =>
  makeRequest({ ...o, headers: { Authorization: "Bearer service_role_svc", ...(o.headers ?? {}) } });

const ENV = {
  RESEND_API_KEY: "re_test_key",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service_role_svc",
};
const KNOWN_TEMPLATE = "artist-offer-digest";

function recordingFetch() {
  const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = ((...args: Parameters<typeof fetch>) => {
    const [url, init] = args;
    fetchCalls.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(new Response(JSON.stringify({ id: "re_123" }), { status: 200 }));
  }) as typeof fetch;
  return { fetchImpl, fetchCalls };
}

function happyPathTables() {
  return {
    suppressed_emails: { data: null, error: null },
    email_unsubscribe_tokens: { data: { token: "existing_token_abc123", used_at: null }, error: null },
    app_settings: { data: null, error: null },
    email_send_log: { data: null, error: null },
  };
}

function sentBody(fetchCalls: Array<{ url: string; init: RequestInit }>) {
  const call = fetchCalls.find((c) => c.url.includes("resend.com"));
  assertExists(call, "Expected a fetch call to api.resend.com");
  return JSON.parse((call!.init as RequestInit & { body?: string }).body ?? "{}");
}

Deno.test("reply_to: forwarded to the Resend body", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  const res = await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "rt@test.com", reply_to: "office@example.com" },
    }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(sentBody(fetchCalls).reply_to, "office@example.com");
});

Deno.test("reply_to: absent means no reply_to key", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  const res = await handle(
    authedReq({ body: { templateName: KNOWN_TEMPLATE, recipientEmail: "rt2@test.com" } }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals("reply_to" in sentBody(fetchCalls), false);
});

Deno.test("reply_to: invalid address returns 400 and does not call Resend", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  const res = await handle(
    authedReq({
      body: { templateName: KNOWN_TEMPLATE, recipientEmail: "rt3@test.com", reply_to: "not-an-address" },
    }),
    deps,
  );
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "invalid reply_to" });
  assertEquals(fetchCalls.some((c) => c.url.includes("resend.com")), false);
});

for (
  const [label, value] of [
    ["comma list", "a@b.co,evil@x.io"],
    ["semicolon list", "a@b.co;evil@x.io"],
    ["comma in local part", "a,evil@b.co"],
    ["angle brackets", "Evil <a@b.co>"],
    ["quotes", '"a"@b.co'],
    ["whitespace", "a@b.co evil@x.io"],
    ["255 chars", `${"a".repeat(245)}@example.com`],
  ]
) {
  Deno.test(`reply_to: ${label} is rejected`, async () => {
    const { fetchImpl, fetchCalls } = recordingFetch();
    const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
    const res = await handle(
      authedReq({ body: { templateName: KNOWN_TEMPLATE, recipientEmail: "rt4@test.com", reply_to: value } }),
      deps,
    );
    assertEquals(res.status, 400);
    assertEquals(fetchCalls.some((c) => c.url.includes("resend.com")), false);
  });
}

Deno.test("reply_to: 254 chars is accepted", async () => {
  const { fetchImpl, fetchCalls } = recordingFetch();
  const { deps } = makeFakeDeps({ envVars: ENV, tables: happyPathTables(), fetchImpl });
  const addr = `${"a".repeat(242)}@example.com`;
  assertEquals(addr.length, 254);
  const res = await handle(
    authedReq({ body: { templateName: KNOWN_TEMPLATE, recipientEmail: "rt5@test.com", reply_to: addr } }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(sentBody(fetchCalls).reply_to, addr);
});
