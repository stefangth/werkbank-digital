// werkbank-reports (Teil 6a, R7): the visit report PDF of an order.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { makeFakeDeps, makeRequest, type TableSeed } from "../_shared/testing.ts";
import type { VisitReportPdfData } from "../_shared/werkbank/pdf/visitReportData.ts";
import { handle } from "./index.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const ORDER = "33333333-3333-4333-8333-333333333333";
const R1 = "66666666-6666-4666-8666-666666666661";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);

const profile = { org_id: ORG, company_name: "Muster Sanitär", street: "Werkstr. 2", postal_code: "80331", city: "München", logo_path: null };
const order = { id: ORDER, org_id: ORG, order_no: "AU-0042", customer_id: "c", property_id: null, subject: null };
const report = { id: R1, org_id: ORG, order_id: ORDER, technician_name: "Ben", visit_date: "2026-10-06", body: "x", locked_at: null, signed_at: null, signer_name: null, signature_path: null };

interface Setup {
  role?: string | null;
  orgKind?: string;
  order?: Record<string, unknown> | null;
  reports?: Record<string, unknown>[];
  profile?: Record<string, unknown> | null;
  authUser?: { id: string } | null;
}

function setup(s: Setup = {}) {
  const tables: Record<string, TableSeed> = {
    // A single-object seed is filtered by requireOrgRole's .in("role", ...); the array seed scopes
    // the default producer membership to ORG.
    org_memberships: s.role === undefined
      ? [{ when: { org_id: ORG }, data: { role: "producer" } }]
      : { data: s.role === null ? null : { role: s.role }, error: null },
    organizations: [{ when: { id: ORG }, data: { org_kind: s.orgKind ?? "handwerk" } }, { when: { id: OTHER_ORG }, data: { org_kind: "handwerk" } }],
    "werkbank.orders": [{ when: { org_id: ORG, id: ORDER }, data: s.order === undefined ? order : s.order }, { data: null }],
    "werkbank.company_profiles": { data: s.profile === undefined ? profile : s.profile, error: null },
    "werkbank.customers": { data: { id: "c", kind: "private", first_name: "Anna", last_name: "Muster" }, error: null },
    "werkbank.document_items": { data: [], error: null },
    "werkbank.visit_reports": [{ when: { org_id: ORG, order_id: ORDER }, data: s.reports ?? [report] }, { data: [] }],
    "werkbank.visit_report_photos": { data: [], error: null },
  };
  const fake = makeFakeDeps({ authUser: s.authUser === undefined ? { id: "u-1" } : s.authUser ?? undefined, tables });
  const rendered: VisitReportPdfData[] = [];
  const render = {
    renderVisitReportPdf: (data: VisitReportPdfData) => {
      rendered.push(data);
      return Promise.resolve(PDF);
    },
  };
  return { ...fake, rendered, render };
}

const request = (body: unknown, headers: Record<string, string> = { Authorization: "Bearer user-jwt" }) =>
  makeRequest({ headers, body });

Deno.test("returns the PDF of the order's reports", async () => {
  const t = setup();
  const res = await handle(request({ org_id: ORG, order_id: ORDER }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/pdf");
  assertEquals(res.headers.get("Cache-Control"), "no-store");
  assertEquals(new Uint8Array(await res.arrayBuffer()), PDF);
  assertEquals(t.rendered[0].orderNumber, "AU-0042");
  assertEquals(t.rendered[0].reports.map((r) => r.id), [R1]);
  // Stores nothing.
  assertEquals(t.calls.filter((c) => ["insert", "update", "upsert", "delete", "upload", "remove", "rpc"].includes(c.method)), []);
});

Deno.test("report_ids is passed to the reports query", async () => {
  const t = setup();
  const res = await handle(request({ org_id: ORG, order_id: ORDER, report_ids: [R1] }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(t.calls.some((c) => c.table === "werkbank.visit_reports" && c.method === "in" && JSON.stringify(c.args) === JSON.stringify(["id", [R1]])), true);
});

Deno.test("bad JSON and malformed bodies are 400", async () => {
  const t = setup();
  const raw = new Request("http://localhost/fn", { method: "POST", headers: { Authorization: "Bearer user-jwt" }, body: "{" });
  assertEquals((await handle(raw, t.deps, t.render)).status, 400);
  assertEquals((await handle(request({ org_id: ORG }), t.deps, t.render)).status, 400);
  assertEquals((await handle(request({ org_id: ORG, order_id: ORDER, report_ids: "x" }), t.deps, t.render)).status, 400);
  assertEquals((await handle(request({ org_id: ORG, order_id: ORDER, report_ids: [] }), t.deps, t.render)).status, 400);
  assertEquals((await handle(request({ org_id: ORG, order_id: ORDER, report_ids: [1] }), t.deps, t.render)).status, 400);
  assertEquals((await handle(request({ org_id: ORG, order_id: ORDER, report_ids: ["not-a-uuid"] }), t.deps, t.render)).status, 400);
  assertEquals((await handle(request({ org_id: "org", order_id: ORDER }), t.deps, t.render)).status, 400);
  assertEquals((await handle(request({ org_id: ORG, order_id: "order" }), t.deps, t.render)).status, 400);
  assertEquals(t.rendered.length, 0);
});

Deno.test("without a header or a valid session it is 401", async () => {
  const t = setup();
  assertEquals((await handle(request({ org_id: ORG, order_id: ORDER }, {}), t.deps, t.render)).status, 401);
  const anon = setup({ authUser: null });
  assertEquals((await handle(request({ org_id: ORG, order_id: ORDER }), anon.deps, anon.render)).status, 401);
});

Deno.test("an artist or a non-member is 403", async () => {
  for (const role of ["artist", null]) {
    const t = setup({ role });
    const res = await handle(request({ org_id: ORG, order_id: ORDER }), t.deps, t.render);
    assertEquals(res.status, 403, String(role));
    assertEquals(t.rendered.length, 0);
  }
});

Deno.test("a producer of another org is 403", async () => {
  const t = setup();
  const res = await handle(request({ org_id: OTHER_ORG, order_id: ORDER }), t.deps, t.render);
  assertEquals(res.status, 403);
});

Deno.test("a non-handwerk org is 404", async () => {
  const t = setup({ orgKind: "production" });
  const res = await handle(request({ org_id: ORG, order_id: ORDER }), t.deps, t.render);
  assertEquals(res.status, 404);
  assertEquals(t.calls.some((c) => c.table === "werkbank.orders"), false);
});

Deno.test("an unknown order is 404", async () => {
  const t = setup({ order: null });
  const res = await handle(request({ org_id: ORG, order_id: ORDER }), t.deps, t.render);
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
});

Deno.test("an order without (matching) reports is 404 no_reports", async () => {
  const t = setup({ reports: [] });
  const res = await handle(request({ org_id: ORG, order_id: ORDER }), t.deps, t.render);
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "no_reports" });
});

Deno.test("a missing company profile is 422 profile_incomplete", async () => {
  const t = setup({ profile: null });
  const res = await handle(request({ org_id: ORG, order_id: ORDER }), t.deps, t.render);
  assertEquals(res.status, 422);
  assertEquals(await res.json(), { error: "preflight_failed", blockers: ["profile_incomplete"] });
});

Deno.test("a render failure is 500", async () => {
  const t = setup();
  const res = await handle(request({ org_id: ORG, order_id: ORDER }), t.deps, { renderVisitReportPdf: () => Promise.reject(new Error("boom")) });
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "render_failed" });
});
