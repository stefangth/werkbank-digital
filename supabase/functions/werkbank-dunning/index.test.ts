// werkbank-dunning (R5): preview, issue (incl. resume) and download-url.
import { assert, assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  asTypedClient,
  createFakeClient,
  type FakeDepsOptions,
  makeFakeDeps,
  makeRequest,
  type RecordedCall,
  type TableSeed,
} from "../_shared/testing.ts";
import type { DunningData } from "../_shared/werkbank/pdf/dunningData.ts";
import { sha256Hex } from "../_shared/werkbank/quoteToken.ts";
import { handle } from "./index.ts";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const INV = "33333333-3333-4333-8333-333333333333";
const NOTICE = "55555555-5555-4555-8555-555555555555";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const PATH = `${ORG}/dunning/${NOTICE}.pdf`;

const profile = {
  org_id: ORG, company_name: "Muster Sanitär", legal_form: "GmbH", street: "Werkstr. 2", postal_code: "80331",
  city: "München", country_code: "DE", phone: null, email: "buero@muster.de", website: null,
  tax_number: "143/123/45678", vat_id: null, register_court: null, register_number: null,
  iban: "DE02120300000000202051", bic: null, bank_name: null, logo_path: null, dunning_deadline_days: 7,
  reminder_text: null, dunning1_text: null, dunning2_text: null,
};
const { org_id: _o, ...sellerSnapshot } = profile;
const buyerSnapshot = {
  name: "Muster, Anna", street: "Hauptstr. 1", postal_code: "80331", city: "München", country_code: "DE",
  customer_no: "K-10001", vat_id: null, invoice_email: "re@example.com", is_private: true, billing_override: false,
  property: null,
};
const invoice = {
  id: INV, org_id: ORG, type: "invoice", invoice_no: "RE-0007", status: "issued", issue_date: "2026-09-01",
  due_date: "2026-09-15", seller_snapshot: sellerSnapshot, buyer_snapshot: buyerSnapshot,
  pdf_path: `${ORG}/invoices/${INV}.pdf`,
};
const balance = {
  invoice_id: INV, org_id: ORG, claim: 119, paid: 19, open_amount: 100, written_off: 0, property_name: "Haus A",
};
const noticeRow = (over: Record<string, unknown> = {}) => ({
  id: NOTICE, org_id: ORG, invoice_id: INV, stage: 1, notice_date: "2026-10-08", payment_deadline: "2026-10-15",
  invoice_gross: 119, paid_amount: 19, open_amount: 100, delivery: "email", pdf_path: null, pdf_sha256: null,
  sent_at: null, sent_to: null, ...over,
});

interface Setup {
  invoice?: Record<string, unknown> | null;
  notices?: Record<string, unknown>[];
  orgKind?: string;
  rpc?: { data?: unknown; error?: unknown };
  opts?: FakeDepsOptions;
}

function setup(s: Setup = {}) {
  const tables: Record<string, TableSeed> = {
    org_memberships: [{ when: { org_id: ORG }, data: { role: "producer" } }],
    organizations: [{ when: { id: ORG }, data: { org_kind: s.orgKind ?? "handwerk" } }],
    "werkbank.invoices": [{ when: { id: INV, org_id: ORG }, data: s.invoice === undefined ? invoice : s.invoice }],
    "werkbank.invoice_balances": { data: balance, error: null },
    "werkbank.company_profiles": { data: profile, error: null },
    "werkbank.dunning_notices": [
      { when: { id: NOTICE, org_id: ORG }, data: (s.notices ?? [])[0] ?? null },
      { when: { __write: true }, data: { id: NOTICE } },
      { data: s.notices ?? [], error: null },
    ],
  };
  const fake = makeFakeDeps({ authUser: { id: "u-1" }, tables, ...s.opts });
  const user = createFakeClient({
    authUser: { id: "u-1" },
    rpcs: { "werkbank.create_dunning_notice": s.rpc ?? { data: noticeRow(), error: null } },
  });
  fake.deps.userClient = () => asTypedClient(user.client);
  const rendered: DunningData[] = [];
  const render = {
    pdf: (data: DunningData) => {
      rendered.push(data);
      return Promise.resolve(PDF);
    },
  };
  return { ...fake, userCalls: user.calls, rendered, render };
}

const request = (body: Record<string, unknown>) => makeRequest({ headers: { Authorization: "Bearer user-jwt" }, body });
const issueBody = { action: "issue", org_id: ORG, invoice_id: INV, delivery: "email", payment_deadline: "2026-10-15" };

function writes(calls: RecordedCall[]) {
  return calls.filter((c) => ["update", "insert", "upsert", "delete", "upload", "remove", "rpc"].includes(c.method));
}

// ── gates ────────────────────────────────────────────────────────────────────

Deno.test("a producer of another org is forbidden", async () => {
  const t = setup();
  const res = await handle(request({ action: "preview", org_id: OTHER_ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "forbidden" });
});

Deno.test("a non-handwerk org gets not_handwerk", async () => {
  const t = setup({ orgKind: "production" });
  const res = await handle(request(issueBody), t.deps, t.render);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "not_handwerk" });
  assertEquals(writes([...t.calls, ...t.userCalls]), []);
});

Deno.test("an unknown invoice is not_found", async () => {
  const t = setup({ invoice: null });
  const res = await handle(request({ action: "preview", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
});

Deno.test("bad requests: unknown action, missing id, malformed deadline, bad delivery", async () => {
  const t = setup();
  assertEquals((await handle(request({ action: "x", org_id: ORG, invoice_id: INV }), t.deps, t.render)).status, 400);
  assertEquals((await handle(request({ action: "preview", org_id: ORG }), t.deps, t.render)).status, 400);
  const bad = await handle(request({ ...issueBody, payment_deadline: "15.10.2026" }), t.deps, t.render);
  assertEquals(bad.status, 400);
  assertEquals(await bad.json(), { error: "bad_request" });
  assertEquals((await handle(request({ ...issueBody, delivery: "fax" }), t.deps, t.render)).status, 400);
  assertEquals(writes([...t.calls, ...t.userCalls]), []);
});

// ── preview ──────────────────────────────────────────────────────────────────

Deno.test("preview renders the next stage as a draft and writes nothing", async () => {
  const t = setup({ notices: [noticeRow({ pdf_path: PATH })] });
  const res = await handle(
    request({ action: "preview", org_id: ORG, invoice_id: INV, payment_deadline: "2026-10-20" }),
    t.deps,
    t.render,
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "application/pdf");
  assertEquals(new Uint8Array(await res.arrayBuffer()), PDF);
  const d = t.rendered[0];
  assertEquals(d.draft, true);
  assertEquals(d.stage, 2);
  assertEquals(d.paymentDeadline, "2026-10-20");
  assertEquals(d.invoiceGross, 119);
  assertEquals(d.paidAmount, 19);
  assertEquals(d.openAmount, 100);
  assertEquals(d.invoice.propertyName, "Haus A");
  assertEquals(d.earlierNotices, [{ stage: 1, date: "2026-10-08" }]);
  assertEquals(writes([...t.calls, ...t.userCalls]), []);
});

Deno.test("preview defaults the deadline to Berlin today plus the profile's days", async () => {
  const t = setup({ opts: { now: new Date("2026-10-08T22:30:00Z") } });
  const res = await handle(request({ action: "preview", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 200);
  // 22:30 UTC is already Oct 9 in Berlin; +7 days.
  assertEquals(t.rendered[0].noticeDate, "2026-10-09");
  assertEquals(t.rendered[0].paymentDeadline, "2026-10-16");
  assertEquals(t.rendered[0].stage, 1);
});

Deno.test("preview with stage 3 already issued is 409 max_stage", async () => {
  const t = setup({ notices: [noticeRow({ stage: 3 })] });
  const res = await handle(request({ action: "preview", org_id: ORG, invoice_id: INV }), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "not_allowed", blockers: ["max_stage"] });
});

// ── issue ────────────────────────────────────────────────────────────────────

Deno.test("issue calls the RPC with the caller's client, uploads, then stamps through the admin client", async () => {
  const t = setup();
  const res = await handle(request(issueBody), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { notice_id: NOTICE, stage: 1 });

  const rpc = t.userCalls.find((c) => c.table === "rpc:werkbank.create_dunning_notice");
  assertExists(rpc);
  assertEquals(rpc.args[0], { p_invoice: INV, p_delivery: "email", p_payment_deadline: "2026-10-15" });
  assertEquals(t.calls.filter((c) => c.method === "rpc"), []);

  assertEquals(t.rendered[0].draft, false);
  const upload = t.calls.find((c) => c.method === "upload");
  assertExists(upload);
  assertEquals(upload.args[0], PATH);
  assertEquals(upload.args[2], { contentType: "application/pdf", upsert: false });
  const update = t.calls.find((c) => c.table === "werkbank.dunning_notices" && c.method === "update");
  assertExists(update);
  assertEquals(update.args[0], { pdf_path: PATH, pdf_sha256: await sha256Hex(PDF) });
  assert(t.calls.some((c) => c.table === "werkbank.dunning_notices" && c.method === "is" && c.args[0] === "pdf_path"));
});

Deno.test("issue without a deadline sends the profile default to the RPC", async () => {
  const t = setup({ opts: { now: new Date("2026-10-08T10:00:00Z") } });
  const { payment_deadline: _p, ...body } = issueBody;
  const res = await handle(request(body), t.deps, t.render);
  assertEquals(res.status, 200);
  const rpc = t.userCalls.find((c) => c.table === "rpc:werkbank.create_dunning_notice");
  assertEquals((rpc?.args[0] as Record<string, unknown>).p_payment_deadline, "2026-10-15");
});

Deno.test("dunning_not_allowed maps to 409 with the blockers and stores nothing", async () => {
  const t = setup({
    rpc: { data: null, error: { code: "22023", message: "dunning_not_allowed", details: "nothing_open,on_hold" } },
  });
  const res = await handle(request(issueBody), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "not_allowed", blockers: ["nothing_open", "on_hold"] });
  assertEquals(writes(t.calls), []);
  assertEquals(t.rendered.length, 0);
});

Deno.test("the RPC's role check is 403", async () => {
  const t = setup({ rpc: { data: null, error: { code: "42501", message: "not allowed" } } });
  const res = await handle(request(issueBody), t.deps, t.render);
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "forbidden" });
});

Deno.test("a render error after the RPC is render_failed with issued, and the retry resumes without the RPC", async () => {
  const t = setup();
  const failing = { pdf: () => Promise.reject(new Error("boom")) };
  const res = await handle(request(issueBody), t.deps, failing);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "render_failed", issued: true });
  assertEquals(writes(t.calls), []);

  // The notice now exists without a file: the second call renders and stores that one.
  const retry = setup({ notices: [noticeRow()] });
  const res2 = await handle(request(issueBody), retry.deps, retry.render);
  assertEquals(res2.status, 200);
  assertEquals(await res2.json(), { notice_id: NOTICE, stage: 1 });
  assertEquals(retry.userCalls.filter((c) => c.method === "rpc"), []);
  assertEquals(retry.rendered.length, 1);
  assertEquals(retry.calls.find((c) => c.method === "upload")?.args[0], PATH);
  assert(retry.calls.some((c) => c.table === "werkbank.dunning_notices" && c.method === "update"));
});

Deno.test("an upload failure is render_failed with issued", async () => {
  const t = setup({ opts: { storageUploadResult: { data: null, error: { statusCode: "500", message: "down" } } } });
  const res = await handle(request(issueBody), t.deps, t.render);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "render_failed", issued: true });
});

Deno.test("the file already stored: its bytes are stamped, nothing is removed", async () => {
  const stored = new Uint8Array([1, 2, 3]);
  const t = setup({
    notices: [noticeRow()],
    opts: {
      storageUploadResult: { data: null, error: { statusCode: "409", message: "The resource already exists" } },
      storageDownloadResult: { data: new Blob([stored]), error: null },
    },
  });
  const res = await handle(request(issueBody), t.deps, t.render);
  assertEquals(res.status, 200);
  const update = t.calls.find((c) => c.table === "werkbank.dunning_notices" && c.method === "update");
  assertEquals(update?.args[0], { pdf_path: PATH, pdf_sha256: await sha256Hex(stored) });
  assertEquals(t.calls.filter((c) => c.method === "remove"), []);
});

Deno.test("print delivery never sends an email", async () => {
  const t = setup();
  const res = await handle(request({ ...issueBody, delivery: "print" }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(t.invokeCalls.length, 0);
});

// ── download-url ─────────────────────────────────────────────────────────────

Deno.test("download-url returns a 60 s signed URL", async () => {
  const t = setup({ notices: [noticeRow({ pdf_path: PATH })] });
  const res = await handle(request({ action: "download-url", org_id: ORG, notice_id: NOTICE }), t.deps, t.render);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { url: `https://signed.test/werkbank-documents/${PATH}` });
  const sign = t.calls.find((c) => c.method === "createSignedUrl");
  assertEquals(sign?.args, [PATH, 60]);
});

Deno.test("download-url without a stored file is 409 pdf_missing; unknown notice is 404", async () => {
  const t = setup({ notices: [noticeRow()] });
  const res = await handle(request({ action: "download-url", org_id: ORG, notice_id: NOTICE }), t.deps, t.render);
  assertEquals(res.status, 409);
  assertEquals(await res.json(), { error: "pdf_missing" });
  const none = setup();
  const res2 = await handle(request({ action: "download-url", org_id: ORG, notice_id: NOTICE }), none.deps, none.render);
  assertEquals(res2.status, 404);
});
