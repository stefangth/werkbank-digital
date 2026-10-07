import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handle, WERKBANK_ORDER } from "./index.ts";
import type { Database } from "../_shared/database.types.ts";
import { makeFakeDeps, makeRequest } from "../_shared/testing.ts";

const AUTH = { Authorization: "Bearer jwt", "content-type": "application/json" };

Deno.test("super-admin gets an org bundle", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: {
      platform_admins: { data: { user_id: "sa" }, error: null },
      organizations: { data: [{ id: "o1", name: "Acme" }], error: null },
      org_memberships: { data: [], error: null },
      artists: { data: [], error: null },
      shows: { data: [], error: null },
      show_dates: { data: [], error: null },
      bookings: { data: [], error: null },
      booking_audit_log: { data: [], error: null },
      chats: { data: [], error: null },
      chat_messages: { data: [], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: AUTH, body: { org_id: "o1" } }), deps);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
  assertEquals(body.bundle.schema_version, 1);
  assertEquals(body.bundle.organizations[0].name, "Acme");
});

Deno.test("non-super-admin is forbidden", async () => {
  const { deps } = makeFakeDeps({ authUser: { id: "u1" }, tables: { platform_admins: { data: null, error: null } } });
  const res = await handle(makeRequest({ headers: AUTH, body: { org_id: "o1" } }), deps);
  assertEquals(res.status, 403);
});

const SUPER_ADMIN = { platform_admins: { data: { user_id: "sa" }, error: null } };
const customerRows = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `c${from + i}`, org_id: "o1" }));

Deno.test("bundle includes the werkbank tables filtered by org", async () => {
  const { deps, calls } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: {
      ...SUPER_ADMIN,
      "werkbank.customers": { data: [{ id: "c1", org_id: "o1" }], error: null },
      "werkbank.quotes": { data: [{ id: "q1", org_id: "o1" }], error: null },
    },
  });
  const res = await handle(makeRequest({ headers: AUTH, body: { org_id: "o1" } }), deps);
  assertEquals(res.status, 200);
  const { bundle } = await res.json();
  assertEquals(bundle.werkbank.customers, [{ id: "c1", org_id: "o1" }]);
  assertEquals(bundle.werkbank.quotes, [{ id: "q1", org_id: "o1" }]);
  const quoteEqs = calls.filter((c) => c.table === "werkbank.quotes" && c.method === "eq");
  assertEquals(quoteEqs.map((c) => c.args), [["org_id", "o1"]]);
  for (
    const t of [
      "properties", "contacts", "catalog_items", "number_ranges",
      "company_profiles", "orders", "order_technicians", "document_items", "quote_acceptances",
    ]
  ) {
    assertEquals(bundle.werkbank[t], []);
  }
  const eqs = calls.filter((c) => c.table === "werkbank.customers" && c.method === "eq");
  assertEquals(eqs.map((c) => c.args), [["org_id", "o1"]]);
});

Deno.test("werkbank tables are read in pages of 1000", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: {
      ...SUPER_ADMIN,
      "werkbank.customers": [
        { when: { __range: "0-999" }, data: customerRows(1000), error: null },
        { when: { __range: "1000-1999" }, data: customerRows(3, 1000), error: null },
      ],
    },
  });
  const res = await handle(makeRequest({ headers: AUTH, body: { org_id: "o1" } }), deps);
  const { bundle } = await res.json();
  assertEquals(bundle.werkbank.customers.length, 1003);
});

Deno.test("a werkbank read error returns 500", async () => {
  const { deps } = makeFakeDeps({
    authUser: { id: "sa" },
    tables: {
      ...SUPER_ADMIN,
      "werkbank.customers": { data: null, error: { message: "boom" } },
    },
  });
  const res = await handle(makeRequest({ headers: AUTH, body: { org_id: "o1" } }), deps);
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "Failed to read werkbank.customers");
});

// number_ranges has no id column (PK org_id, key): real PostgREST rejects order=id with 42703, which
// the fake would accept, so the sort column per table is pinned here and type-checked in index.ts.
type WerkbankRow<T extends keyof Database["werkbank"]["Tables"]> = keyof Database["werkbank"]["Tables"][T]["Row"];
const _numberRangesHasNoId: "id" extends WerkbankRow<"number_ranges"> ? never : true = true;
const _numberRangesHasKey: "key" extends WerkbankRow<"number_ranges"> ? true : never = true;
void _numberRangesHasNoId;
void _numberRangesHasKey;

Deno.test("each werkbank table is paged in the order of a column it has", async () => {
  const { deps, calls } = makeFakeDeps({ authUser: { id: "sa" }, tables: { ...SUPER_ADMIN } });
  const res = await handle(makeRequest({ headers: AUTH, body: { org_id: "o1" } }), deps);
  assertEquals(res.status, 200);
  const orders: Record<string, unknown[]> = {};
  for (const c of calls.filter((c) => c.table.startsWith("werkbank.") && c.method === "order")) {
    (orders[c.table.slice("werkbank.".length)] ??= []).push(c.args[0]);
  }
  assertEquals(orders, {
    customers: ["id"],
    properties: ["id"],
    contacts: ["id"],
    catalog_items: ["id"],
    number_ranges: ["key"],
    company_profiles: ["org_id"],
    quotes: ["id"],
    orders: ["id"],
    // composite key (order_id, artist_id): the second column keeps pages stable
    order_technicians: ["order_id", "artist_id"],
    document_items: ["id"],
    quote_acceptances: ["id"],
  });
  assertEquals(Object.keys(orders).sort(), Object.keys(WERKBANK_ORDER).sort());
});
